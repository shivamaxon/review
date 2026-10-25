-- Review snapshots and commitments are separate from mutable operational facts.
alter table public.review_sessions add column associate_id uuid references public.profiles, add column snapshot jsonb, add column finalized_at timestamptz, add column lock_entries boolean not null default false;
alter table public.review_actions add column completion_comment text, add column published_at timestamptz, add column carried_from uuid references public.review_actions;
alter table public.review_actions drop constraint review_actions_status_check;
alter table public.review_actions add constraint review_actions_status_check check(status in('open','done','dropped','carried_over'));
create unique index review_draft_unique on public.review_sessions(associate_id,period_start,period_end) where status='draft' and deleted_at is null;
create unique index review_carried_unique on public.review_actions(session_id,carried_from) where carried_from is not null and deleted_at is null;
create index review_person_final_idx on public.review_sessions(associate_id,finalized_at desc) where status='final' and deleted_at is null;
create index review_locks_idx on public.review_sessions(associate_id,period_start,period_end) where status='final' and lock_entries and deleted_at is null;

create table public.review_rules(branch_id uuid not null references public.branches,rule text not null check(rule in('hot_stale','hot_no_plot','overdue','warm_stale','cold_future','token_stale','cancellations','cp_no_leads','double_hot')),enabled boolean not null default true,days integer not null default 0 check(days between 0 and 365),updated_at timestamptz not null default now(),primary key(branch_id,rule));
alter table public.review_rules enable row level security;
create policy review_rules_read on public.review_rules for select to authenticated using(branch_id=my_branch() or my_role()='super_admin');
create policy review_rules_write on public.review_rules for all to authenticated using(is_admin() and(branch_id=my_branch() or my_role()='super_admin')) with check(is_admin() and(branch_id=my_branch() or my_role()='super_admin'));
create trigger review_rules_updated before update on public.review_rules for each row execute function set_updated_at();
create trigger review_rules_audit after insert or update on public.review_rules for each row execute function audit_row();
grant select,insert,update on public.review_rules to authenticated;
grant all on public.review_rules to service_role;

create function public.review_actor(p_admin boolean default false) returns public.profiles language plpgsql stable security definer set search_path=public as $$
declare me profiles;begin
 select * into me from profiles where id=auth.uid() and active and deleted_at is null and not must_change_password;
 if me.id is null or(p_admin and me.role not in('branch_admin','super_admin')) then raise exception 'Permission denied' using errcode='42501';end if;return me;
end $$;
create function public.review_require_person(p_id uuid) returns public.profiles language plpgsql stable security invoker set search_path=public as $$
declare p profiles;begin
 if not is_reviewer() then raise exception 'Reviewer access required' using errcode='42501';end if;
 select * into p from profiles where id=p_id and id in(select visible_associates()) and deleted_at is null and role in('associate','team_lead');
 if p.id is null then raise exception 'Associate is outside your scope' using errcode='42501';end if;return p;
end $$;
create function public.review_rule(p_branch uuid,p_rule text) returns jsonb language sql stable security invoker set search_path=public as $$
 select coalesce((select jsonb_build_object('enabled',enabled,'days',days) from review_rules where branch_id=p_branch and rule=p_rule),jsonb_build_object('enabled',true,'days',case p_rule when 'hot_stale' then 5 when 'warm_stale' then 21 when 'token_stale' then 10 when 'cp_no_leads' then 30 else 0 end))
$$;
create function public.review_targets(p_id uuid,p_from date,p_to date) returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('meetings',ceil(sum(customer_meetings*w)),'hot',ceil(sum(hot_leads*w)),'cp_meetings',ceil(sum(cp_meetings*w)),'bookings',ceil(sum(bookings*w))) from(select t.*,((least(p_to,(month+interval '1 month - 1 day')::date)-greatest(p_from,month)+1)::numeric/extract(day from month+interval '1 month - 1 day')) w from targets t where associate_id=p_id and deleted_at is null and month<=p_to and(month+interval '1 month - 1 day')::date>=p_from) x
$$;

create function public.review_asks(p_associate uuid,p_filters jsonb) returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare person profiles:=review_require_person(p_associate);ctx jsonb:=analysis_context(p_filters);asof date:=least((ctx->>'to')::date,(now() at time zone 'Asia/Kolkata')::date);f jsonb:=p_filters||jsonb_build_object('associates',jsonb_build_array(p_associate),'branch',person.branch_id);result jsonb;
begin
 with pipeline as materialized(select p from jsonb_array_elements(analysis_pipeline(f,asof)) p),changes as materialized(select * from analysis_transitions(f,asof)),
 rules as(select r,review_rule(person.branch_id,r) config from unnest(array['hot_stale','hot_no_plot','overdue','warm_stale','cold_future','token_stale','cancellations','cp_no_leads','double_hot']) r),
 lead_asks as(select r.r rule,'leads'::text table_name,(p->>'id')::uuid record_id,p->>'name' name,
 case r.r when 'hot_stale' then 'Hot: no touch for '||(p->>'age_days')||' days' when 'hot_no_plot' then 'Hot: plot names missing' when 'overdue' then 'Next action overdue: '||(p->>'next_action_date') when 'warm_stale' then 'Warm: no stage movement within threshold' when 'cold_future' then 'Cold with a future follow-up: confirm rating and nurture plan' when 'double_hot' then 'Plot is Hot for competing customers' end detail
 from pipeline,rules r where(r.config->>'enabled')::boolean and case r.r
 when 'hot_stale' then p->>'rating'='hot' and coalesce((p->>'age_days')::int,999999)>=(r.config->>'days')::int
 when 'hot_no_plot' then p->>'rating'='hot' and jsonb_array_length(p->'plots')=0
 when 'overdue' then(p->>'next_action_date')::date<asof
 when 'cold_future' then p->>'rating'='cold' and(p->>'next_action_date')::date>asof
 when 'warm_stale' then p->>'rating'='warm' and asof-coalesce((select max(happened_on) from changes where lead_id=(p->>'id')::uuid),asof)>=(r.config->>'days')::int
 when 'double_hot' then p->>'rating'='hot' and exists(select 1 from jsonb_array_elements(analysis_pipeline(f-'associates',asof)) q join leads l on l.id=(q->>'id')::uuid join leads own on own.id=(p->>'id')::uuid and own.project_id=l.project_id where q->>'rating'='hot' and q->>'id'<>p->>'id' and exists(select 1 from jsonb_array_elements_text(p->'plots') a join jsonb_array_elements_text(q->'plots') b on lower(trim(a))=lower(trim(b)))) else false end),
 book_asks as(select r.r rule,'bookings' table_name,b.id record_id,b.lead_name name,case r.r when 'token_stale' then 'Token pending for '||(asof-b.happened_on)||' days' else 'Cancellation: '||coalesce(b.cancel_reason,'Reason not recorded') end detail from analysis_rows('bookings',f,null,asof) b,rules r where(r.config->>'enabled')::boolean and((r.r='token_stale' and b.status='token' and asof-b.happened_on>=(r.config->>'days')::int) or(r.r='cancellations' and b.status='cancelled' and b.happened_on>=(ctx->>'from')::date))),
 latest_cp as(select distinct on(cp_id) * from analysis_rows('cp_meetings',f,null,asof) order by cp_id,happened_on desc,created_at desc,id desc),
 cp_asks as(select r.r rule,'channel_partners' table_name,cp_id record_id,cp_name name,'CP is '||rating||' but has no linked leads in '||(r.config->>'days')||' days' detail from latest_cp c,rules r where r.r='cp_no_leads' and(r.config->>'enabled')::boolean and c.rating in('hot','active') and not exists(select 1 from analysis_rows('leads',f,asof-(r.config->>'days')::int+1,asof) l where l.cp_id=c.cp_id and l.source='cp')),
 all_asks as(select * from lead_asks union all select * from book_asks union all select * from cp_asks)
 select coalesce(jsonb_agg(to_jsonb(a) order by case rule when 'double_hot' then 0 when 'cancellations' then 1 else 2 end,rule,name),'[]') into result from all_asks a;return result;
end $$;

create or replace function public.analysis_context(p_filters jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare today date:=(now() at time zone 'Asia/Kolkata')::date; a date;b date;pa date;pb date;l text; mode text:=coalesce(p_filters->>'window','cycle'); branch uuid:=coalesce(nullif(p_filters->>'branch','')::uuid,my_branch());
begin
 select date_from,date_to,label into a,b,l from analysis_cycle(today,branch);
 if mode='last_cycle' then select date_from,date_to,label into a,b,l from analysis_cycle(a-1,branch);
 elsif mode='last10' then a:=today-9;b:=today;l:='Last 10 days';
 elsif mode='mtd' then a:=date_trunc('month',today)::date;b:=today;l:='Month to date';
 elsif mode='custom' then a:=coalesce(nullif(p_filters->>'from','')::date,a);b:=coalesce(nullif(p_filters->>'to','')::date,b);l:='Custom';end if;
 if a>b then raise exception 'Start date must be on or before end date';end if;
 if mode in ('cycle','last_cycle') or p_filters->>'review_previous_cycle'='true' then select date_from,date_to into pa,pb from analysis_cycle(a-1,branch);
 elsif mode='mtd' then pa:=(a-interval '1 month')::date;pb:=least(pa+(b-a),(a-1));
 else pa:=a-(b-a+1);pb:=a-1;end if;
 return jsonb_build_object('from',a,'to',b,'previous_from',pa,'previous_to',pb,'label',l);
end $$;

-- A later status event can be dated even when the original booking date is unknown.
create or replace function public.analysis_transitions(p_filters jsonb,p_to date)
returns table(id uuid,record_id uuid,dataset text,lead_id uuid,lead_name text,associate_id uuid,associate_name text,happened_on date,stage text,previous text,next_day date,stamp timestamptz)
language sql stable security invoker set search_path=public as $$
 with events as(
 select i.id,i.id record_id,i.dataset,i.lead_id,i.lead_name,i.associate_id,i.associate_name,i.happened_on,i.rating stage,i.created_at stamp from analysis_rows('all',p_filters-'dimensions'-'q',null,p_to) i where i.dataset='meetings' and i.rating is not null
 union all select h.id,b.id,b.dataset,b.lead_id,b.lead_name,b.associate_id,b.associate_name,
 case when h.status_before is null then b.happened_on else (h.changed_at at time zone 'Asia/Kolkata')::date end,
 case h.status_after when 'booking_done' then 'booked' when 'agreement_signed' then 'agreement' else h.status_after::text end,h.changed_at from analysis_rows('bookings',p_filters-'dimensions'-'q',null,null) b join booking_status_history h on h.booking_id=b.id and h.deleted_at is null),
 sequenced as(select *,lag(stage) over(partition by lead_id order by happened_on,stamp,id) previous from events where happened_on<=p_to),
 changes as(select * from sequenced where stage is distinct from previous)
 select id,record_id,dataset,lead_id,lead_name,associate_id,associate_name,happened_on,stage,previous,
 lead(happened_on) over(partition by lead_id order by happened_on,stamp,id),stamp from changes
$$;
create function public.review_pack(p_associate uuid,p_filters jsonb default '{}') returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare person profiles:=review_require_person(p_associate);ctx jsonb:=analysis_context(p_filters||jsonb_build_object('review_previous_cycle',true,'branch',person.branch_id));f jsonb:=p_filters||jsonb_build_object('associates',jsonb_build_array(p_associate),'branch',person.branch_id,'compare','true','review_previous_cycle',true);last_review review_sessions;result jsonb;change_from date;
begin
 select * into last_review from review_sessions where associate_id=p_associate and status='final' and deleted_at is null and period_end<(ctx->>'from')::date order by period_end desc,finalized_at desc limit 1;
 change_from:=coalesce(last_review.period_end+1,(ctx->>'from')::date);
 select jsonb_build_object('metric_dictionary_version','20260101000009_review','person',jsonb_build_object('id',person.id,'name',person.full_name,'branch_id',person.branch_id,'branch_name',(select name from branches where id=person.branch_id),'designation',person.designation,'manager',(select full_name from profiles where id=person.reports_to)),'context',ctx,'dashboard',analysis_dashboard(f),'targets',review_targets(p_associate,(ctx->>'from')::date,(ctx->>'to')::date),'previous_targets',review_targets(p_associate,(ctx->>'previous_from')::date,(ctx->>'previous_to')::date),
 'asks',review_asks(p_associate,f),'changes_from',change_from,'changes',analysis_movement(f||jsonb_build_object('window','custom','from',change_from,'to',ctx->>'to')),
 'legacy_stats',(select to_jsonb(m) from associate_metrics((ctx->>'from')::date,(ctx->>'to')::date) m where m.associate_id=p_associate),
 'detail_rows',(select coalesce(jsonb_agg(to_jsonb(e)-'search_document'),'[]') from analysis_rows('all',f,(ctx->>'from')::date,(ctx->>'to')::date) e where e.dataset<>'leads'),
 'movement_rows',(select coalesce(jsonb_agg(to_jsonb(t) order by happened_on desc),'[]') from analysis_transitions(f,(ctx->>'to')::date) t where happened_on between change_from and(ctx->>'to')::date),
 'new_hot',(select coalesce(jsonb_agg(to_jsonb(e)-'search_document'),'[]') from analysis_metric_rows('hot_leads',f,change_from,(ctx->>'to')::date) e where not exists(select 1 from interactions i where i.lead_id=e.lead_id and i.rating_after='hot' and i.occurred_on<change_from and i.deleted_at is null)),
 'new_bookings',jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(e)-'search_document'),'[]') from analysis_events e where e.dataset='bookings' and e.associate_id=p_associate and exists(select 1 from booking_status_history h where h.booking_id=e.id and h.deleted_at is null and h.status_after in('booking_done','agreement_signed') and(case when h.status_before is null then e.happened_on else(h.changed_at at time zone 'Asia/Kolkata')::date end) between change_from and(ctx->>'to')::date))),
 'new_cancellations',jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(e)-'search_document'),'[]') from analysis_events e where e.dataset='bookings' and e.associate_id=p_associate and exists(select 1 from booking_status_history h where h.booking_id=e.id and h.deleted_at is null and h.status_after='cancelled' and(case when h.status_before is null then e.happened_on else(h.changed_at at time zone 'Asia/Kolkata')::date end) between change_from and(ctx->>'to')::date))),
 'last_review',case when last_review.id is not null then jsonb_build_object('id',last_review.id,'held_on',last_review.held_on,'period_end',last_review.period_end) end,
 'commitments',(select coalesce(jsonb_agg(to_jsonb(a) order by a.due_date nulls last,a.created_at),'[]') from review_actions a where a.associate_id=p_associate and a.published_at is not null and a.deleted_at is null and(a.session_id=last_review.id or a.status='open'))) into result;
 return result;
end $$;

-- Direct writes cannot forge a frozen KPI or publish somebody else's action.
revoke insert,update on public.review_sessions,public.review_actions from authenticated;
drop policy review_sessions_select on public.review_sessions;
create policy review_sessions_select on public.review_sessions for select to authenticated using(is_reviewer() and((associate_id is not null and associate_id in(select visible_associates())) or(associate_id is null and is_admin() and(branch_id=my_branch() or my_role()='super_admin'))));
drop policy review_actions_select on public.review_actions;
create policy review_actions_select on public.review_actions for select to authenticated using((is_reviewer() and associate_id in(select visible_associates())) or(associate_id=auth.uid() and published_at is not null));
create function public.review_session_guard() returns trigger language plpgsql as $$
begin if old.status='final' then raise exception 'Finalised reviews are immutable. Start a new review.';end if;return new;end $$;
create trigger review_session_frozen before update or delete on public.review_sessions for each row execute function review_session_guard();

create function public.review_begin(p_associate uuid,p_from date,p_to date) returns uuid language plpgsql security definer set search_path=public as $$
declare me profiles:=review_actor();person profiles;rec uuid;begin
 person:=review_require_person(p_associate);if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then raise exception 'Choose a review window of up to one year';end if;
 insert into review_sessions(branch_id,associate_id,period_start,period_end,cycle_label,created_by) values(person.branch_id,p_associate,p_from,p_to,'Review',me.id) on conflict(associate_id,period_start,period_end) where status='draft' and deleted_at is null do update set updated_at=now() returning id into rec;return rec;
end $$;
create function public.review_edit(p_session uuid,p_summary text,p_action text default null,p_owner uuid default null,p_due date default null,p_carry uuid default null,p_remove uuid default null) returns uuid language plpgsql security definer set search_path=public as $$
declare me profiles:=review_actor();s review_sessions;owner profiles;rec uuid;old_action review_actions;begin
 select * into s from review_sessions where id=p_session and deleted_at is null for update;if s.id is null or s.status<>'draft' then raise exception 'Open a draft review first';end if;
 perform review_require_person(s.associate_id);
 if length(coalesce(p_summary,''))>20000 then raise exception 'Notes must be under 20,000 characters';end if;
 update review_sessions set summary=p_summary where id=s.id;
 if p_remove is not null then update review_actions set deleted_at=clock_timestamp() where id=p_remove and session_id=s.id and published_at is null and deleted_at is null;return s.id;end if;
 if nullif(trim(p_action),'') is not null or p_carry is not null then
  owner:=review_require_person(coalesce(p_owner,s.associate_id));if not owner.active then raise exception 'Choose an active action owner';end if;if owner.branch_id<>s.branch_id then raise exception 'Action owner must be in the review branch';end if;
  if p_due is null then raise exception 'Choose an action due date';end if;
  if p_carry is not null then select * into old_action from review_actions where id=p_carry and associate_id=owner.id and published_at is not null and status='open' and deleted_at is null;if not found then raise exception 'Only open commitments can be carried over';end if;p_action:=old_action.action;end if;
  if length(trim(p_action)) not between 1 and 2000 then raise exception 'Action must be 1–2,000 characters';end if;
  insert into review_actions(branch_id,session_id,associate_id,action,due_date,carried_from,created_by) values(s.branch_id,s.id,owner.id,trim(p_action),p_due,p_carry,me.id) returning id into rec;
 end if;return coalesce(rec,s.id);
end $$;
create function public.review_finalize(p_session uuid,p_lock boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare me profiles:=review_actor();s review_sessions;pack jsonb;begin
 -- Serialize finalisation with entry writes, including legacy direct writes.
 lock table leads,interactions,cp_interactions,bookings in share row exclusive mode;
 select * into s from review_sessions where id=p_session and deleted_at is null for update;if s.id is null then raise exception 'Review not found';end if;
 perform review_require_person(s.associate_id);if s.status='final' then return s.snapshot;end if;
 pack:=review_pack(s.associate_id,jsonb_build_object('window','custom','from',s.period_start,'to',s.period_end,'compare','true'));
 pack:=pack||jsonb_build_object('notes',s.summary,'review_id',s.id,'reviewer_id',me.id,'agreed_actions',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('owner_name',(select full_name from profiles where id=a.associate_id)) order by a.due_date),'[]') from review_actions a where session_id=s.id and deleted_at is null));
 update review_actions set status='carried_over' where id in(select carried_from from review_actions where session_id=s.id and deleted_at is null) and status='open';
 update review_actions set published_at=clock_timestamp() where session_id=s.id and deleted_at is null;
 update review_sessions set snapshot=pack,status='final',held_on=(now() at time zone 'Asia/Kolkata')::date,finalized_at=clock_timestamp(),lock_entries=p_lock where id=s.id;
 return pack;
end $$;
create function public.commitment_complete(p_id uuid,p_comment text) returns void language plpgsql security definer set search_path=public as $$
declare me profiles:=review_actor();begin
 if length(trim(coalesce(p_comment,''))) not between 1 and 2000 then raise exception 'Add a short completion comment';end if;
 update review_actions set status='done',completed_at=clock_timestamp(),completion_comment=trim(p_comment) where id=p_id and associate_id=me.id and published_at is not null and status='open' and deleted_at is null;
 if not found then raise exception 'This open commitment is not yours' using errcode='42501';end if;
end $$;

create function public.review_entry_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare oldj jsonb;newj jsonb;person uuid;d date;begin
 if auth.uid() is null or is_admin() then if tg_op='DELETE' then return old;else return new;end if;end if;
 if tg_op='INSERT' then newj:=to_jsonb(new);else oldj:=to_jsonb(old);end if;
 if tg_op='UPDATE' then newj:=to_jsonb(new);if(newj-array['updated_at','rating_before'])=(oldj-array['updated_at','rating_before']) then return new;end if;end if;
 for person,d in select (j->>'associate_id')::uuid,coalesce(j->>'occurred_on',j->>'booking_date')::date from jsonb_array_elements(jsonb_build_array(oldj,newj)) j where j is not null and j<>'null'::jsonb loop
  if exists(select 1 from review_sessions where associate_id=person and status='final' and lock_entries and deleted_at is null and d between period_start and period_end) then raise exception 'This entry is in a finalised, locked review. Ask an admin to correct it.' using errcode='42501';end if;
 end loop;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger review_lock_guard before insert or update or delete on public.interactions for each row execute function review_entry_guard();
create trigger review_lock_guard before insert or update or delete on public.cp_interactions for each row execute function review_entry_guard();
create trigger review_lock_guard before insert or update or delete on public.bookings for each row execute function review_entry_guard();

-- Admin changes use invoker RLS for targets/config and checked definer RPCs for guarded history.
create function public.admin_reassign(p_from uuid,p_to uuid) returns integer language plpgsql security definer set search_path=public as $$
declare me profiles:=review_actor(true);a profiles;b profiles;n integer;begin
 select * into a from profiles where id=p_from;select * into b from profiles where id=p_to and active and deleted_at is null;
 if a.id is null or b.id is null or a.branch_id<>b.branch_id or a.id=b.id or b.role not in('associate','team_lead') or(me.role<>'super_admin' and a.branch_id<>me.branch_id) then raise exception 'Choose different people in the same managed branch' using errcode='42501';end if;
 update leads set owner_id=b.id where owner_id=a.id and deleted_at is null;get diagnostics n=row_count;return n;
end $$;
create function public.admin_record(p_table text,p_id uuid,p_patch jsonb default '{}',p_deleted boolean default null) returns void language plpgsql security definer set search_path=public as $$
declare me profiles:=review_actor(true);r jsonb;allowed text[];cols text;key text;guard text;begin
 if p_table<>all(array['leads','interactions','cp_interactions','bookings','channel_partners']) then raise exception 'Table is not editable';end if;
 execute format('select to_jsonb(t) from public.%I t where id=$1 for update',p_table) into r using p_id;
 if r is null or(me.role<>'super_admin' and r->>'branch_id'<>me.branch_id::text) then raise exception 'Record is outside your branch' using errcode='42501';end if;
 allowed:=case p_table when 'leads' then array['name','phone'] when 'interactions' then array['occurred_on','mode','rating_after','remark','next_action','next_action_date','plot_names','cold_reason','site_visit_status','nurture_note'] when 'cp_interactions' then array['occurred_on','mode','rating_after','remark','next_action','next_action_date','contact_phone'] when 'bookings' then array['status','booking_date','plot_no','value','cancel_reason','remarks'] else array['name','firm','phone'] end;
 for key in select jsonb_object_keys(p_patch) loop if not(key=any(allowed)) then raise exception 'Field is not editable';end if;end loop;
 if p_table in('interactions','cp_interactions') then guard:=p_table||'_history_guard';execute format('alter table public.%I disable trigger %I',p_table,guard);end if;
 if p_patch<>'{}' then
  if p_table='bookings' and coalesce(p_patch->>'status',r->>'status')='cancelled' and nullif(trim(coalesce(p_patch->>'cancel_reason',r->>'cancel_reason')),'') is null then raise exception 'Cancellation reason required';end if;
  if p_table='leads' and p_patch?'name' and nullif(trim(p_patch->>'name'),'') is null then raise exception 'Name required';end if;
  select string_agg(format('%1$I=x.%1$I',k),',') into cols from jsonb_object_keys(p_patch) k;
  execute format('update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I,$1) x where t.id=$2',p_table,cols) using p_patch,p_id;
 end if;
 if p_deleted is not null then execute format('update public.%I set deleted_at=case when $1 then clock_timestamp() else null end where id=$2',p_table) using p_deleted,p_id;end if;
 if p_table in('interactions','cp_interactions') then perform rechain_history(p_table,coalesce((r->>'lead_id')::uuid,(r->>'cp_id')::uuid),(r->>'associate_id')::uuid);execute format('alter table public.%I enable trigger %I',p_table,guard);end if;
end $$;

create function public.branch_rollup(p_filters jsonb default '{}') returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare me profiles:=review_actor();b record;r jsonb:='[]';begin
 if me.role<>'super_admin' then raise exception 'Super admin required' using errcode='42501';end if;
 for b in select * from branches where deleted_at is null order by name loop r:=r||jsonb_build_array(jsonb_build_object('id',b.id,'name',b.name,'dashboard',analysis_dashboard(p_filters||jsonb_build_object('branch',b.id,'compare','true'))));end loop;return r;
end $$;

revoke all on function public.review_actor(boolean),public.review_require_person(uuid),public.review_rule(uuid,text),public.review_targets(uuid,date,date),public.review_asks(uuid,jsonb),public.review_pack(uuid,jsonb),public.review_begin(uuid,date,date),public.review_edit(uuid,text,text,uuid,date,uuid,uuid),public.review_finalize(uuid,boolean),public.commitment_complete(uuid,text),public.admin_reassign(uuid,uuid),public.admin_record(text,uuid,jsonb,boolean),public.branch_rollup(jsonb) from public,anon;
grant execute on function public.review_actor(boolean),public.review_require_person(uuid),public.review_rule(uuid,text),public.review_targets(uuid,date,date),public.review_asks(uuid,jsonb),public.review_pack(uuid,jsonb),public.review_begin(uuid,date,date),public.review_edit(uuid,text,text,uuid,date,uuid,uuid),public.review_finalize(uuid,boolean),public.commitment_complete(uuid,text),public.admin_reassign(uuid,uuid),public.admin_record(text,uuid,jsonb,boolean),public.branch_rollup(jsonb) to authenticated;

alter table public.branches add column is_demo boolean not null default false;
create function public.admin_settings(p_kind text,p_data jsonb) returns uuid language plpgsql security invoker set search_path=public as $$
declare me profiles:=review_actor(true);rec uuid:=nullif(p_data->>'id','')::uuid;b uuid:=coalesce(nullif(p_data->>'branch_id','')::uuid,me.branch_id);label text:=trim(coalesce(p_data->>'label',p_data->>'name',''));person profiles;begin
 if me.role<>'super_admin' and b<>me.branch_id then raise exception 'Choose your own branch' using errcode='42501';end if;
 if p_kind='branch' then
  if me.role<>'super_admin' then raise exception 'Super admin required' using errcode='42501';end if;
  if length(label) not between 1 and 100 then raise exception 'Branch name must be 1–100 characters';end if;
  insert into branches(name,code,created_by) values(label,nullif(trim(p_data->>'code'),''),me.id) returning id into rec;
  insert into review_cycle(branch_id,label,start_day,end_day,sort_order,created_by) values(rec,'P1',1,10,1,me.id),(rec,'P2',11,20,2,me.id),(rec,'P3',21,null,3,me.id);return rec;
 elsif p_kind='target' then
  if date_trunc('month',(p_data->>'month')::date)::date<>(p_data->>'month')::date then raise exception 'Choose the first day of the target month';end if;
  person:=review_require_person((p_data->>'associate_id')::uuid);if person.branch_id<>b then raise exception 'Associate must be in this branch';end if;
  insert into targets(branch_id,associate_id,month,customer_meetings,hot_leads,cp_meetings,bookings,created_by) values(b,person.id,(p_data->>'month')::date,(p_data->>'meetings')::int,(p_data->>'hot')::int,(p_data->>'cp_meetings')::int,(p_data->>'bookings')::int,me.id)
  on conflict(associate_id,month) where deleted_at is null do update set customer_meetings=excluded.customer_meetings,hot_leads=excluded.hot_leads,cp_meetings=excluded.cp_meetings,bookings=excluded.bookings returning id into rec;return rec;
 elsif p_kind='rule' then
  insert into review_rules(branch_id,rule,enabled,days) values(b,p_data->>'rule',(p_data->>'enabled')::boolean,(p_data->>'days')::int) on conflict(branch_id,rule) do update set enabled=excluded.enabled,days=excluded.days;return b;
 elsif p_kind in('projects','cold_reasons','next_action_types','review_cycle') then
  if length(label) not between 1 and 150 then raise exception 'Label must be 1–150 characters';end if;
  if rec is null then rec:=gen_random_uuid();end if;
  if p_kind='projects' then insert into projects(id,name,active,created_by) values(rec,label,coalesce((p_data->>'active')::boolean,true),me.id) on conflict(id) do update set name=excluded.name,active=excluded.active;
  elsif p_kind='review_cycle' then
   if exists(select 1 from review_cycle where branch_id=b and deleted_at is null and id<>rec and int4range(start_day,coalesce(end_day,31),'[]')&&int4range((p_data->>'start_day')::int,coalesce(nullif(p_data->>'end_day','')::int,31),'[]')) then raise exception 'Review windows cannot overlap';end if;
   insert into review_cycle(id,branch_id,label,start_day,end_day,sort_order,created_by) values(rec,b,label,(p_data->>'start_day')::int,nullif(p_data->>'end_day','')::int,coalesce((p_data->>'sort_order')::int,0),me.id) on conflict(id) do update set label=excluded.label,start_day=excluded.start_day,end_day=excluded.end_day,sort_order=excluded.sort_order;
  else execute format('insert into public.%I(id,label,active,sort_order,created_by) values($1,$2,$3,$4,$5) on conflict(id) do update set label=excluded.label,active=excluded.active,sort_order=excluded.sort_order',p_kind) using rec,label,coalesce((p_data->>'active')::boolean,true),coalesce((p_data->>'sort_order')::int,0),me.id;end if;return rec;
 end if;raise exception 'Unknown setting';
end $$;
revoke all on function public.admin_settings(text,jsonb) from public,anon;
grant execute on function public.admin_settings(text,jsonb) to authenticated;

-- The new owner sees prior history; meeting/booking attribution remains with the original author.
create policy reassigned_interactions_read on public.interactions for select to authenticated using(exists(select 1 from leads l where l.id=lead_id and l.owner_id=auth.uid()));
create policy reassigned_bookings_read on public.bookings for select to authenticated using(exists(select 1 from leads l where l.id=lead_id and l.owner_id=auth.uid()));

create function public.review_master(p_filters jsonb default '{}',p_session uuid default null) returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare me profiles:=review_actor();ctx jsonb:=analysis_context(p_filters);packs jsonb:='[]';r record;p jsonb;totals jsonb;begin
 if not is_reviewer() then raise exception 'Reviewer access required' using errcode='42501';end if;
 if p_session is not null then
  select snapshot into p from review_sessions where id=p_session and status='final' and deleted_at is null;
  if p is null then raise exception 'Choose a visible finalised review';end if;packs:=jsonb_build_array(p);ctx:=p->'context';
 else
  for r in select id from profiles where active and deleted_at is null and role in('associate','team_lead') and id in(select visible_associates()) and(nullif(p_filters->>'branch','') is null or branch_id=(p_filters->>'branch')::uuid) and(coalesce(jsonb_array_length(p_filters->'associates'),0)=0 or id::text in(select jsonb_array_elements_text(p_filters->'associates'))) order by full_name loop
   packs:=packs||jsonb_build_array(review_pack(r.id,p_filters));
  end loop;
 end if;
 with rows as(select entry->'legacy_stats' m,entry->'targets' t from jsonb_array_elements(packs) entry),
 sums as(select sum((m->>'customer_meetings')::numeric) meetings,sum((m->>'leads_met')::numeric) leads_met,sum((m->>'hot_leads')::numeric) hot,sum((m->>'warm_leads')::numeric) warm,sum((m->>'cold_leads')::numeric) cold,sum((m->>'cps_met')::numeric) cps_met,sum((m->>'cp_active')::numeric) cp_active,sum((m->>'cp_hot')::numeric) cp_hot,sum((m->>'cp_warm')::numeric) cp_warm,sum((m->>'cp_cold')::numeric) cp_cold,sum((m->>'bookings')::numeric) bookings,sum((m->>'booking_value')::numeric) value,sum((m->>'tokens')::numeric) tokens,sum((m->>'cancelled')::numeric) cancelled,sum((t->>'bookings')::numeric) target from rows)
 select to_jsonb(s)||jsonb_build_object('hot_pct',coalesce(round(100*hot/nullif(leads_met,0),2),0),'variance',bookings-target,'achievement_pct',round(100*bookings/nullif(target,0),2)) into totals from sums s;
 return jsonb_build_object('context',ctx,'branch_name',(select string_agg(distinct item->'person'->>'branch_name',', ') from jsonb_array_elements(packs) item),'packs',packs,'totals',totals);
end $$;
revoke all on function public.review_master(jsonb,uuid) from public,anon;
grant execute on function public.review_master(jsonb,uuid) to authenticated;
