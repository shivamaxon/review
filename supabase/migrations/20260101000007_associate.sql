-- Associate entry: atomic/idempotent saves, scoped audited corrections and undo.
alter table public.interactions add column site_visit_status text check(site_visit_status in ('not_planned','planned','done')), add column nurture_note text;
alter table public.cp_interactions add column contact_phone text;
alter table public.leads add column site_visit_status text, add column nurture_note text;
alter table public.targets add column hot_leads integer not null default 0 check(hot_leads>=0);
create table public.entry_receipts (
 id uuid primary key, associate_id uuid not null references public.profiles, kind text not null,
 table_name text not null, record_id uuid not null, lead_id uuid, cp_id uuid,
 before_data jsonb, after_data jsonb, parent_before jsonb, parent_after jsonb, payload_hash text not null, created_parent boolean not null default false,
 created_at timestamptz not null default clock_timestamp(), undone_at timestamptz
);
alter table public.entry_receipts enable row level security;
revoke all on public.entry_receipts from anon,authenticated;
grant select on public.entry_receipts to authenticated;
grant all on public.entry_receipts to service_role;
create policy receipts_own on public.entry_receipts for select to authenticated using(associate_id=auth.uid());

-- A cancelled offline request must stay cancelled if its original response was lost.
create table public.entry_cancellations(id uuid primary key,associate_id uuid not null references public.profiles,created_at timestamptz not null default clock_timestamp());
alter table public.entry_cancellations enable row level security;
revoke all on public.entry_cancellations from anon,authenticated;
grant select on public.entry_cancellations to authenticated;
grant all on public.entry_cancellations to service_role;
create policy cancellations_own on public.entry_cancellations for select to authenticated using(associate_id=auth.uid());

create function public.normalized_person(p_name text) returns text language sql immutable set search_path=public as $$
 select lower(regexp_replace(trim(p_name),'[^[:alnum:]]','','g'))
$$;
revoke all on function public.normalized_person(text) from public,anon;
grant execute on function public.normalized_person(text) to authenticated,service_role;
create index leads_identity_idx on public.leads(owner_id,public.normalized_person(name)) where deleted_at is null;

-- Recompute chronological rating changes after an older entry is corrected.
-- The caller holds the table lock while the append-only guard is suspended.
create function public.rechain_history(p_table text,p_parent uuid,p_associate uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_table='interactions' then
  update interactions i set rating_before=x.previous from (
   select id,lag(rating_after) over(order by occurred_on,created_at,id) previous
   from interactions where lead_id=p_parent and deleted_at is null
  ) x where i.id=x.id and i.rating_before is distinct from x.previous;
  perform refresh_lead_from_interactions(p_parent);
 else
  update cp_interactions i set rating_before=x.previous from (
   select id,lag(rating_after) over(order by occurred_on,created_at,id) previous
   from cp_interactions where cp_id=p_parent and associate_id=p_associate and deleted_at is null
  ) x where i.id=x.id and i.rating_before is distinct from x.previous;
  perform refresh_cp_from_interactions(p_parent);
 end if;
end $$;
revoke all on function public.rechain_history(text,uuid,uuid) from public,anon,authenticated;

create or replace function public.refresh_lead_from_interactions(p_lead uuid) returns void
language plpgsql security definer set search_path=public as $$
declare x interactions%rowtype;
begin
 select * into x from interactions where lead_id=p_lead and deleted_at is null order by occurred_on desc,created_at desc,id desc limit 1;
 if not found then return; end if;
 update leads l set current_rating=x.rating_after,last_touch_at=x.occurred_on::timestamp at time zone 'Asia/Kolkata',
 last_touch_on=x.occurred_on,next_action=x.next_action,next_action_date=x.next_action_date,
 cold_reason=case when x.rating_after='cold' then x.cold_reason end,
 plot_names=case when cardinality(x.plot_names)>0 then x.plot_names else l.plot_names end,
 site_visit_status=x.site_visit_status,nurture_note=x.nurture_note
 where id=p_lead;
end $$;

create function public.validate_customer_entry(p jsonb) returns void language plpgsql set search_path=public as $$
declare d date:=(p->>'occurred_on')::date; rating text:=p->>'rating_after'; next_date date:=nullif(p->>'next_action_date','')::date;
begin
 if rating is null or rating<>all(array['hot','warm','cold']) then raise exception 'Choose Hot, Warm or Cold'; end if;
 if d is null then raise exception 'Choose a meeting date'; end if;
 if rating='hot' and (jsonb_array_length(coalesce(p->'plot_names','[]'))=0 or next_date is null or next_date<d or next_date>d+7) then
 raise exception 'Hot needs a plot and a next-action date within 7 days of the meeting'; end if;
 if rating='cold' and nullif(trim(p->>'cold_reason'),'') is null then raise exception 'Choose a Cold reason'; end if;
end $$;
revoke all on function public.validate_customer_entry(jsonb) from public,anon,authenticated;

create function public.associate_save(p_kind text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me profiles%rowtype; prior entry_receipts%rowtype; parent uuid; cp uuid; rec uuid; tab text;
 before_row jsonb; after_row jsonb; parent_row jsonb; created_parent boolean:=false;
 p jsonb:=p_payload; cols text; allowed text[]; k text; guard_name text; duplicate uuid; effective jsonb; parent_after jsonb;
begin
 select * into me from profiles where id=auth.uid() and active and deleted_at is null and not must_change_password;
 if not found then raise exception 'Sign in and choose your own password first' using errcode='42501'; end if;
 if p_request_id is null then raise exception 'Request ID required'; end if;
 perform pg_advisory_xact_lock(hashtext(p_request_id::text));
 if exists(select 1 from entry_cancellations where id=p_request_id) then raise exception 'This entry was undone. Start a new entry instead of retrying it.'; end if;
 select * into prior from entry_receipts where id=p_request_id;
 if found then
  if prior.associate_id<>me.id then raise exception 'Request is not yours' using errcode='42501'; end if;
  if prior.payload_hash<>md5(p_kind||(p_payload-array['lead_id','cp_id','expected_updated_at'])::text) then raise exception 'This request was already saved with different contents. Open My Sheet before correcting it.'; end if;
  return jsonb_build_object('id',prior.record_id,'lead_id',prior.lead_id,'cp_id',prior.cp_id,'request_id',prior.id,'already_saved',true);
 end if;
 if p_kind not in ('customer','cp','booking','edit_interaction','edit_cp_interaction','edit_lead','edit_booking') then raise exception 'Unknown entry type'; end if;
 if p_kind in ('customer','booking') then
  parent:=nullif(p->>'lead_id','')::uuid;
  if parent is null then
   if nullif(public.normalized_person(p->>'name'),'') is null then raise exception 'Enter a customer name'; end if;
   perform pg_advisory_xact_lock(hashtext(me.id::text||public.normalized_person(p->>'name')));
   select id into duplicate from leads where owner_id=me.id and deleted_at is null and
    (public.normalized_person(name)=public.normalized_person(p->>'name') or
     (length(regexp_replace(coalesce(p->>'phone',''),'\D','','g'))>=10 and right(regexp_replace(phone,'\D','','g'),10)=right(regexp_replace(p->>'phone','\D','','g'),10))) limit 1;
   if found then return jsonb_build_object('duplicate_lead_id',duplicate,'message','This customer already exists. Log a follow-up.'); end if;
   insert into leads(branch_id,name,phone,owner_id,project_id,source,created_by)
   values(me.branch_id,trim(p->>'name'),nullif(p->>'phone',''),me.id,nullif(p->>'project_id','')::uuid,nullif(p->>'source','')::lead_source,me.id) returning id into parent;
   created_parent:=true;
  end if;
  select to_jsonb(l) into parent_row from leads l where id=parent and owner_id=me.id and deleted_at is null for update;
  if not found then raise exception 'Choose one of your own customers' using errcode='42501'; end if;
  if nullif(p->>'phone','') is not null then update leads set phone=p->>'phone' where id=parent and phone is distinct from p->>'phone'; end if;
 end if;
 if p_kind='customer' then
  perform validate_customer_entry(p);
  tab:='interactions';
  insert into interactions(branch_id,lead_id,associate_id,interaction_type,occurred_on,mode,rating_after,remark,next_action,next_action_date,plot_names,cold_reason,site_visit_status,nurture_note,project_id,created_by)
  values(me.branch_id,parent,me.id,coalesce(nullif(p->>'interaction_type','')::interaction_type,'meeting'),(p->>'occurred_on')::date,
  nullif(p->>'mode','')::meeting_mode,(p->>'rating_after')::rating,nullif(p->>'remark',''),nullif(p->>'next_action',''),nullif(p->>'next_action_date','')::date,
  array(select jsonb_array_elements_text(coalesce(p->'plot_names','[]'))),nullif(p->>'cold_reason',''),nullif(p->>'site_visit_status',''),nullif(p->>'nurture_note',''),nullif(p->>'project_id','')::uuid,me.id) returning id into rec;
  -- A new, nonhistorical action on an imported lead is current work. The lead's
  -- provenance remains historical; Today checks the newest action's provenance.
  if nullif(p->>'project_id','') is not null then update leads set project_id=(p->>'project_id')::uuid where id=parent; end if;
 elsif p_kind='cp' then
  cp:=nullif(p->>'cp_id','')::uuid;
  if cp is null then
   if nullif(trim(p->>'name'),'') is null then raise exception 'Enter a CP name'; end if;
   perform pg_advisory_xact_lock(hashtext(me.branch_id::text||public.normalized_person(p->>'name')||public.normalized_person(coalesce(p->>'firm',''))));
   select id into cp from channel_partners where branch_id=me.branch_id and deleted_at is null and ((normalized_person(name)=normalized_person(p->>'name') and normalized_person(coalesce(firm,''))=normalized_person(coalesce(p->>'firm',''))) or (length(regexp_replace(coalesce(p->>'phone',''),'\D','','g'))>=10 and right(regexp_replace(phone,'\D','','g'),10)=right(regexp_replace(p->>'phone','\D','','g'),10))) limit 1;
   if not found then
    insert into channel_partners(branch_id,name,firm,phone,normalized_key,created_by) values(me.branch_id,trim(p->>'name'),nullif(p->>'firm',''),nullif(p->>'phone',''),'',me.id) returning id into cp;
    created_parent:=true;
   end if;
  end if;
  select to_jsonb(c) into parent_row from channel_partners c where id=cp and branch_id=me.branch_id and deleted_at is null for update;
  if not found then raise exception 'CP is not in your branch' using errcode='42501'; end if;
  if p->>'rating_after' is null or nullif(p->>'occurred_on','') is null then raise exception 'Choose a CP rating and meeting date'; end if;
  tab:='cp_interactions';
  insert into cp_interactions(branch_id,cp_id,associate_id,occurred_on,rating_after,remark,next_action,next_action_date,contact_phone,created_by)
  values(me.branch_id,cp,me.id,(p->>'occurred_on')::date,(p->>'rating_after')::cp_rating,nullif(p->>'remark',''),nullif(p->>'next_action',''),nullif(p->>'next_action_date','')::date,nullif(p->>'phone',''),me.id) returning id into rec;
 elsif p_kind='booking' then
  tab:='bookings';cp:=nullif(p->>'cp_id','')::uuid;
  if p->>'status'='cancelled' and nullif(trim(p->>'cancel_reason'),'') is null then raise exception 'Explain why the booking was cancelled'; end if;
  if p->>'source'='cp' and cp is null then raise exception 'Choose a channel partner'; end if;
  if cp is not null and not exists(select 1 from channel_partners where id=cp and branch_id=me.branch_id and deleted_at is null) then raise exception 'CP is not in your branch'; end if;
  if nullif(trim(p->>'plot_no'),'') is null or nullif(p->>'booking_date','') is null then raise exception 'Choose a plot and booking date'; end if;
  insert into bookings(branch_id,lead_id,associate_id,project_id,plot_no,value,booking_date,status,source,cp_id,cancel_reason,remarks,created_by)
  values(me.branch_id,parent,me.id,nullif(p->>'project_id','')::uuid,p->>'plot_no',nullif(p->>'value','')::numeric,(p->>'booking_date')::date,
  (p->>'status')::booking_status,(p->>'source')::lead_source,cp,nullif(p->>'cancel_reason',''),nullif(p->>'remarks',''),me.id) returning id into rec;
 else
  tab:=case p_kind when 'edit_interaction' then 'interactions' when 'edit_cp_interaction' then 'cp_interactions' when 'edit_lead' then 'leads' else 'bookings' end;
  rec:=(p->>'id')::uuid;
  execute format('select to_jsonb(t) from public.%I t where id=$1 and %I=$2 and deleted_at is null for update',tab,case when tab='leads' then 'owner_id' else 'associate_id' end) into before_row using rec,me.id;
  if before_row is null then raise exception 'You can edit only your own records' using errcode='42501'; end if;
  if p->>'expected_updated_at' is null or (p->>'expected_updated_at')::timestamptz<>(before_row->>'updated_at')::timestamptz then raise exception 'This row changed. Reload before editing.'; end if;
  parent:=case when tab='leads' then rec else (before_row->>'lead_id')::uuid end;cp:=(before_row->>'cp_id')::uuid;
  if parent is not null then select to_jsonb(l) into parent_row from leads l where id=parent; end if;
  if tab='cp_interactions' then select to_jsonb(c) into parent_row from channel_partners c where id=cp; end if;
  p:=p->'patch';
  allowed:=case tab
   when 'leads' then array['name','phone']
   when 'interactions' then array['occurred_on','mode','rating_after','remark','next_action','next_action_date','plot_names','cold_reason','site_visit_status','nurture_note']
   when 'cp_interactions' then array['occurred_on','rating_after','remark','next_action','next_action_date','contact_phone']
   else array['status','booking_date','plot_no','value','cancel_reason','remarks'] end;
  if p is null or p='{}' then raise exception 'Enter a correction'; end if;
  for k in select jsonb_object_keys(p) loop if not(k=any(allowed)) then raise exception 'You cannot change this field: %',k; end if; end loop;
  effective:=before_row||p;
  if tab='interactions' and p ?| array['rating_after','plot_names','cold_reason','next_action_date'] then perform validate_customer_entry(effective); end if;
  if tab='bookings' and effective->>'status'='cancelled' and nullif(trim(effective->>'cancel_reason'),'') is null then raise exception 'Explain why the booking was cancelled'; end if;
  if tab='leads' and nullif(trim(effective->>'name'),'') is null then raise exception 'Customer name is required'; end if;
  if tab in ('interactions','cp_interactions') then
   guard_name:=tab||'_history_guard';execute format('alter table public.%I disable trigger %I',tab,guard_name);
  end if;
  select string_agg(format('%1$I=x.%1$I',key),',') into cols from jsonb_object_keys(p) key;
  execute format('update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I,$1) x where t.id=$2',tab,cols) using p,rec;
 end if;
 if tab in ('interactions','cp_interactions') then
  guard_name:=tab||'_history_guard';execute format('alter table public.%I disable trigger %I',tab,guard_name);
  perform rechain_history(tab,coalesce(parent,cp),me.id);
  execute format('alter table public.%I enable trigger %I',tab,guard_name);
 end if;
 execute format('select to_jsonb(t) from public.%I t where id=$1',tab) into after_row using rec;
 if parent is not null then select to_jsonb(l) into parent_after from leads l where id=parent;
 elsif cp is not null then select to_jsonb(c) into parent_after from channel_partners c where id=cp; end if;
 insert into entry_receipts(id,associate_id,kind,table_name,record_id,lead_id,cp_id,before_data,after_data,parent_before,parent_after,payload_hash,created_parent)
 values(p_request_id,me.id,p_kind,tab,rec,parent,cp,before_row,after_row,parent_row,parent_after,md5(p_kind||(p_payload-array['lead_id','cp_id','expected_updated_at'])::text),created_parent);
 return jsonb_build_object('id',rec,'lead_id',parent,'cp_id',cp,'request_id',p_request_id);
end $$;
revoke all on function public.associate_save(text,jsonb,uuid) from public,anon;
grant execute on function public.associate_save(text,jsonb,uuid) to authenticated;

create function public.associate_undo(p_request_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare r entry_receipts%rowtype; current_row jsonb; cols text; guard_name text; has_live boolean;
begin
 if not exists(select 1 from profiles where id=auth.uid() and active and not must_change_password and deleted_at is null) then raise exception 'Sign in first' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext(p_request_id::text));
 select * into r from entry_receipts where id=p_request_id and associate_id=auth.uid() for update;
 if not found then
  if exists(select 1 from entry_receipts where id=p_request_id) or exists(select 1 from entry_cancellations where id=p_request_id and associate_id<>auth.uid()) then raise exception 'Entry is not yours' using errcode='42501'; end if;
  insert into entry_cancellations(id,associate_id) values(p_request_id,auth.uid()) on conflict do nothing;
  return;
 end if;
 if r.undone_at is not null then return; end if;
 if r.created_at<clock_timestamp()-interval '10 minutes' then raise exception 'Undo expired. Open My Sheet to correct the entry.'; end if;
 execute format('select to_jsonb(t) from public.%I t where id=$1 for update',r.table_name) into current_row using r.record_id;
 if current_row is distinct from r.after_data then raise exception 'Entry changed since you saved. Undo is unavailable.'; end if;
 if r.table_name in ('interactions','cp_interactions') then
  if r.table_name='interactions' then
   if exists(select 1 from interactions where lead_id=r.lead_id and created_at>r.created_at and id<>r.record_id and deleted_at is null) then raise exception 'A newer update exists. Correct this entry in My Sheet.'; end if;
  else
   if exists(select 1 from cp_interactions where cp_id=r.cp_id and created_at>r.created_at and id<>r.record_id and deleted_at is null) then raise exception 'A newer CP update exists.'; end if;
  end if;
  guard_name:=r.table_name||'_history_guard';execute format('alter table public.%I disable trigger %I',r.table_name,guard_name);
 end if;
 if r.before_data is null then
  execute format('update public.%I set deleted_at=clock_timestamp() where id=$1',r.table_name) using r.record_id;
 else
  select string_agg(format('%1$I=x.%1$I',key),',') into cols from jsonb_object_keys(r.before_data) key where key<>all(array['id','created_at','updated_at','remark_tsv','remarks_tsv']);
  execute format('update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I,$1) x where t.id=$2',r.table_name,cols) using r.before_data,r.record_id;
 end if;
 if guard_name is not null then
  perform rechain_history(r.table_name,coalesce(r.lead_id,r.cp_id),r.associate_id);
  execute format('alter table public.%I enable trigger %I',r.table_name,guard_name);
 end if;
 if r.lead_id is not null and r.table_name='interactions' and not exists(select 1 from interactions where lead_id=r.lead_id and deleted_at is null) then
  update leads l set current_rating=x.current_rating,next_action=x.next_action,next_action_date=x.next_action_date,cold_reason=x.cold_reason,
   last_touch_at=x.last_touch_at,last_touch_on=x.last_touch_on,plot_names=x.plot_names,phone=x.phone,project_id=x.project_id,site_visit_status=x.site_visit_status,nurture_note=x.nurture_note
  from jsonb_populate_record(null::leads,r.parent_before) x where l.id=r.lead_id;
 end if;
 if r.lead_id is not null and r.table_name in ('interactions','bookings') then
  update leads l set phone=case when l.phone is not distinct from r.parent_after->>'phone' then r.parent_before->>'phone' else l.phone end,
   project_id=case when l.project_id is not distinct from (r.parent_after->>'project_id')::uuid then (r.parent_before->>'project_id')::uuid else l.project_id end where l.id=r.lead_id;
 end if;
 if r.cp_id is not null and r.table_name='cp_interactions' and not exists(select 1 from cp_interactions where cp_id=r.cp_id and deleted_at is null) then
  update channel_partners c set current_rating=x.current_rating,last_touch_at=x.last_touch_at,next_action=x.next_action,next_action_date=x.next_action_date
  from jsonb_populate_record(null::channel_partners,r.parent_before) x where c.id=r.cp_id;
 end if;
 if r.created_parent then
  if r.lead_id is not null and not exists(select 1 from interactions where lead_id=r.lead_id and deleted_at is null) and not exists(select 1 from bookings where lead_id=r.lead_id and deleted_at is null) then update leads set deleted_at=now() where id=r.lead_id; end if;
  if r.cp_id is not null and not exists(select 1 from cp_interactions where cp_id=r.cp_id and deleted_at is null) and not exists(select 1 from leads where cp_id=r.cp_id and deleted_at is null) and not exists(select 1 from bookings where cp_id=r.cp_id and deleted_at is null) then update channel_partners set deleted_at=now() where id=r.cp_id; end if;
 end if;
 update entry_receipts set undone_at=clock_timestamp() where id=r.id;
 insert into entry_cancellations(id,associate_id) values(p_request_id,auth.uid()) on conflict do nothing;
end $$;
revoke all on function public.associate_undo(uuid) from public,anon;
grant execute on function public.associate_undo(uuid) to authenticated;

-- Conflict counts only: no other associate's customer names/phones are exposed.
create function public.plot_conflicts(p_project uuid,p_plot text,p_lead uuid default null)
returns table(hot_leads bigint,live_bookings bigint) language sql stable security definer set search_path=public as $$
 select (select count(*) from leads where branch_id=my_branch() and project_id=p_project and deleted_at is null and id is distinct from p_lead and current_rating='hot' and exists(select 1 from unnest(plot_names) plot where lower(trim(plot))=lower(trim(p_plot)))),
 (select count(*) from bookings where branch_id=my_branch() and project_id=p_project and deleted_at is null and lead_id is distinct from p_lead and lower(trim(plot_no))=lower(trim(p_plot)) and status in ('token','booking_done','agreement_signed'))
 where my_role() is not null
$$;
revoke all on function public.plot_conflicts(uuid,text,uuid) from public,anon;
grant execute on function public.plot_conflicts(uuid,text,uuid) to authenticated;

create function public.associate_scorecard(p_from date,p_to date) returns jsonb
language sql stable security invoker set search_path=public as $$
 with counts as (select * from associate_metrics(p_from,p_to) where associate_id=auth.uid()),
 goals as (select count(*) n,
 sum(customer_meetings::numeric*(least(p_to,(month+interval '1 month - 1 day')::date)-greatest(p_from,month)+1)/extract(day from month+interval '1 month - 1 day')) meetings,
 sum(hot_leads::numeric*(least(p_to,(month+interval '1 month - 1 day')::date)-greatest(p_from,month)+1)/extract(day from month+interval '1 month - 1 day')) hot,
 sum(cp_meetings::numeric*(least(p_to,(month+interval '1 month - 1 day')::date)-greatest(p_from,month)+1)/extract(day from month+interval '1 month - 1 day')) cp,
 sum(bookings::numeric*(least(p_to,(month+interval '1 month - 1 day')::date)-greatest(p_from,month)+1)/extract(day from month+interval '1 month - 1 day')) bookings
 from targets where associate_id=auth.uid() and deleted_at is null and month<=p_to and (month+interval '1 month - 1 day')::date>=p_from)
 select jsonb_build_object('meetings',coalesce(c.customer_meetings,0),'hot',coalesce(c.hot_leads,0),
 'cp_meetings',(select count(*) from cp_interactions where associate_id=auth.uid() and deleted_at is null and occurred_on between p_from and p_to),
 'bookings',coalesce(c.bookings,0),'targets',jsonb_build_object('meetings',case when g.n>0 then ceil(g.meetings) end,'hot',case when g.n>0 then ceil(g.hot) end,'cp_meetings',case when g.n>0 then ceil(g.cp) end,'bookings',case when g.n>0 then ceil(g.bookings) end))
 from goals g left join counts c on true
$$;
revoke all on function public.associate_scorecard(date,date) from public,anon;
grant execute on function public.associate_scorecard(date,date) to authenticated;


-- Supply missing choices without replacing any administrator's existing choices.
insert into public.cold_reasons(label,sort_order)
 select label,n from unnest(array['Budget','Location','Family decision','Comparing options','Timing','CP-managed','Not interested','Other']) with ordinality as x(label,n)
 where not exists(select 1 from public.cold_reasons c where lower(c.label)=lower(x.label) and c.deleted_at is null);
insert into public.next_action_types(label,sort_order)
 select label,n from unnest(array['Call','Site visit','Zoom','Send price sheet','Awaiting CP','Payment follow-up']) with ordinality as x(label,n)
 where not exists(select 1 from public.next_action_types c where lower(c.label)=lower(x.label) and c.deleted_at is null);
