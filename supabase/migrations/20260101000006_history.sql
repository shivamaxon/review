-- Flat workbook support. Old migrations remain unchanged.
alter table public.profiles add column if not exists legacy_key text unique;
alter table public.profiles add column is_historical boolean not null default false;
alter table public.projects add column legacy_key text unique, add column aliases_seen text, add column is_historical boolean not null default false;
create table public.cp_firms (
 id uuid primary key default gen_random_uuid(), legacy_key text unique, branch_id uuid not null references public.branches,
 name text not null, aliases_seen text, is_freelancer_bucket boolean not null default false,
 cp_people_count integer, booking_rows_count integer, raw_json jsonb,
 is_historical boolean not null default false, created_by uuid references public.profiles,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
alter table public.channel_partners add column legacy_key text unique, add column firm_id uuid references public.cp_firms,
 add column first_met_on date, add column last_met_on date, add column meetings_count integer,
 add column associates_met text[], add column created_from text, add column is_historical boolean not null default false;
alter table public.leads add column legacy_key text unique, add column name_variants text, add column created_from text,
 add column created_on date, add column last_touch_on date, add column meetings_count integer, add column cp_firm_name text,
 add column is_historical boolean not null default false;
alter table public.interactions add column legacy_key text unique, add column date_estimated boolean not null default false,
 add column next_action_date_original text, add column source_tab text, add column source_row integer,
 add column project_id uuid references public.projects, add column customer_name_as_written text, add column phone_as_written text,
 add column is_historical boolean not null default false;
alter table public.cp_interactions add column legacy_key text unique, add column date_estimated boolean not null default false,
 add column next_action_date_original text, add column source_tab text, add column source_row integer,
 add column cp_name_as_written text, add column firm_as_written text, add column is_historical boolean not null default false;
alter table public.bookings add column legacy_key text unique, add column cp_firm_key text references public.cp_firms(legacy_key),
 add column cp_sub_partner text, add column cp_text_as_written text, add column link_confidence text,
 add column cp_firm_name text, add column source_tab text, add column source_row integer,
 add column is_historical boolean not null default false;
-- Unknown means unknown: never turn an unrated meeting into Cold or invent a date.
alter table public.leads alter column current_rating drop not null;
alter table public.channel_partners alter column current_rating drop not null;
alter table public.interactions alter column rating_after drop not null;
alter table public.cp_interactions alter column rating_after drop not null;
alter table public.bookings alter column booking_date drop not null;
create table public.data_quality_issues (
 id uuid primary key default gen_random_uuid(), legacy_key text unique not null,
 branch_id uuid not null references public.branches, severity text not null check(severity in ('fix','review','info')),
 issue_type text not null, table_name text not null check(table_name in ('leads','interactions','cp_interactions','bookings','channel_partners')),
 record_key text, record_ids uuid[] not null default '{}', associate_id uuid references public.profiles,
 assigned_to uuid references public.profiles, source_tab text, source_row text, detail text not null, action_taken text,
 status text not null default 'open' check(status in ('open','resolved','accepted')),
 resolved_by uuid references public.profiles, resolved_at timestamptz, resolution text,
 is_historical boolean not null default false, raw_json jsonb, created_by uuid references public.profiles,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index quality_inbox_idx on public.data_quality_issues(branch_id,status,severity,issue_type);
create index leads_today_idx on public.leads(owner_id,next_action_date) where deleted_at is null and not is_historical;
alter table public.cp_firms enable row level security;
alter table public.data_quality_issues enable row level security;
create policy firms_read on public.cp_firms for select to authenticated using(branch_id=public.my_branch() or public.my_role()='super_admin');
create policy quality_read on public.data_quality_issues for select to authenticated using (
 (public.is_admin() and (branch_id=public.my_branch() or public.my_role()='super_admin')) or assigned_to=auth.uid());
grant select on public.cp_firms, public.data_quality_issues to authenticated;
revoke insert,update,delete on public.cp_firms, public.data_quality_issues from authenticated;
grant all on public.cp_firms, public.data_quality_issues to service_role;
create trigger cp_firms_updated before update on public.cp_firms for each row execute function public.set_updated_at();
create trigger quality_updated before update on public.data_quality_issues for each row execute function public.set_updated_at();
create trigger cp_firms_audit after insert or update on public.cp_firms for each row execute function public.audit_row();
create trigger quality_audit after insert or update on public.data_quality_issues for each row execute function public.audit_row();

-- One RPC = one table transaction. ALTER TABLE locks out concurrent writers, and
-- PostgreSQL rolls back trigger changes on ANY error. No global disable window.
create function public.load_history_table(p_table text,p_rows jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare r jsonb; cols text; updates text; n integer:=0; tr record;
begin
 if p_table <> all(array['profiles','projects','cp_firms','channel_partners','leads','interactions','cp_interactions','bookings','data_quality_issues']) then raise exception 'Unsupported import table'; end if;
 perform pg_advisory_xact_lock(hashtext('load_history_table'));
 -- Only derived-state / append-only guards are suspended; audit stays enabled.
 for tr in select tgname from pg_trigger where tgrelid=('public.'||p_table)::regclass and not tgisinternal and
 tgname in ('interactions_before_insert','interactions_after_insert','interactions_after_softdelete','interactions_history_guard',
 'cp_interactions_before_insert','cp_interactions_after_insert','cp_interactions_after_softdelete','cp_interactions_history_guard',
 'channel_partners_key','bookings_before_insert','bookings_after_insert','bookings_after_update') loop
 execute format('alter table public.%I disable trigger %I',p_table,tr.tgname);
 end loop;
 for r in select value from jsonb_array_elements(p_rows) loop
  if nullif(r->>'legacy_key','') is null or r->>'is_historical' is distinct from 'true' then raise exception 'Missing historical key'; end if;
  if p_table='profiles' then
   update public.profiles set is_historical=true where legacy_key=r->>'legacy_key' and deleted_at is null;
   if not found then raise exception 'Run seed-users first: %',r->>'legacy_key'; end if;
  else
   if p_table='projects' then
    update public.projects set legacy_key=r->>'legacy_key' where lower(name)=lower(r->>'name') and legacy_key is null and deleted_at is null;
   end if;
   select string_agg(format('%I',key),','), string_agg(format('%1$I=excluded.%1$I',key),',') into cols,updates from jsonb_object_keys(r) key where key<>'id';
   -- Preserve administrator decisions on re-run; unchanged rows do not fire audit/update triggers.
   execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1) on conflict(legacy_key) do update set %3$s where not exists (select 1 from public.data_quality_issues q where q.status<>''open'' and %1$I.id=any(q.record_ids)) and %4$s',p_table,cols,updates,case when r ? 'raw_json' then format('%I.raw_json is distinct from $1->''raw_json''',p_table) else format('not(to_jsonb(%I) @> $1)',p_table) end) using r;
  end if;
  n:=n+1;
 end loop;
 for tr in select tgname from pg_trigger where tgrelid=('public.'||p_table)::regclass and not tgisinternal and tgenabled='D' and
 tgname in ('interactions_before_insert','interactions_after_insert','interactions_after_softdelete','interactions_history_guard',
 'cp_interactions_before_insert','cp_interactions_after_insert','cp_interactions_after_softdelete','cp_interactions_history_guard',
 'channel_partners_key','bookings_before_insert','bookings_after_insert','bookings_after_update') loop
 execute format('alter table public.%I enable trigger %I',p_table,tr.tgname);
 end loop;
 if p_table='bookings' then
  insert into booking_status_history(booking_id,branch_id,associate_id,status_after)
   select b.id,b.branch_id,b.associate_id,b.status from bookings b
    where b.legacy_key in (select value->>'legacy_key' from jsonb_array_elements(p_rows))
    and not exists(select 1 from booking_status_history h where h.booking_id=b.id);
 end if;
 return n;
end $$;
revoke all on function public.load_history_table(text,jsonb) from public,anon,authenticated;
grant execute on function public.load_history_table(text,jsonb) to service_role;

-- Reconciliation metrics are row counts, unlike the dashboard's distinct leads.
-- No date cutoff: the source includes real April CP meetings and unknown booking dates.
create function public.history_metrics() returns table(associate_key text,meetings bigint,hot bigint,warm bigint,cold bigint,unrated bigint,cp_meetings bigint,bookings bigint,booking_value numeric)
language sql stable security invoker set search_path=public as $$
 select p.legacy_key,
 (select count(*) from interactions i where i.associate_id=p.id and i.is_historical and i.deleted_at is null and interaction_type='meeting'),
 (select count(*) from interactions i where i.associate_id=p.id and i.is_historical and i.deleted_at is null and interaction_type='meeting' and rating_after='hot'),
 (select count(*) from interactions i where i.associate_id=p.id and i.is_historical and i.deleted_at is null and interaction_type='meeting' and rating_after='warm'),
 (select count(*) from interactions i where i.associate_id=p.id and i.is_historical and i.deleted_at is null and interaction_type='meeting' and rating_after='cold'),
 (select count(*) from interactions i where i.associate_id=p.id and i.is_historical and i.deleted_at is null and interaction_type='meeting' and rating_after is null),
 (select count(*) from cp_interactions i where i.associate_id=p.id and i.is_historical and i.deleted_at is null),
 (select count(*) from bookings b where b.associate_id=p.id and b.is_historical and b.deleted_at is null and status='booking_done'),
 (select coalesce(sum(value),0) from bookings b where b.associate_id=p.id and b.is_historical and b.deleted_at is null and status='booking_done')
 from profiles p where p.legacy_key is not null and p.deleted_at is null
$$;
revoke all on function public.history_metrics() from public,anon;
grant execute on function public.history_metrics() to authenticated,service_role;

-- Admin corrections are scoped to an issue's own records and audited. Ordinary
-- interaction writes remain append-only; only this checked transaction can edit.
create function public.resolve_quality_issue(p_issue uuid,p_action text,p_record uuid default null,p_patch jsonb default '{}'::jsonb,p_assignee uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare q public.data_quality_issues%rowtype; allowed text[]; k text; cols text; guard_name text; target_branch uuid;
begin
 if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
 select * into q from data_quality_issues where id=p_issue and deleted_at is null for update;
 if not found or (q.branch_id<>public.my_branch() and public.my_role()<>'super_admin') then raise exception 'Issue not accessible' using errcode='42501'; end if;
 if p_action='assign' then
  if not exists(select 1 from profiles where id=p_assignee and branch_id=q.branch_id and active and deleted_at is null and role in ('associate','team_lead')) then raise exception 'Choose an active associate in this branch'; end if;
  update data_quality_issues set assigned_to=p_assignee where id=q.id;
  return;
 end if;
 if q.status<>'open' then raise exception 'Issue already decided'; end if;
 if p_action='fix' then
  if not (p_record=any(q.record_ids)) or p_record is null then raise exception 'Record is not part of this issue'; end if;
  allowed:=case q.table_name
   when 'leads' then array['name','phone','current_rating','next_action','next_action_date','cold_reason','plot_names']
   when 'interactions' then array['rating_before','rating_after','occurred_on','mode','remark','next_action','next_action_date','cold_reason','plot_names']
   when 'cp_interactions' then array['rating_before','rating_after','occurred_on','mode','remark','next_action','next_action_date']
   when 'bookings' then array['plot_no','value','booking_date','status','remarks','cp_sub_partner','cp_text_as_written']
   when 'channel_partners' then array['name','phone','firm','current_rating','next_action','next_action_date'] end;
  for k in select jsonb_object_keys(p_patch) loop
   if not(k=any(allowed)) then raise exception 'Field cannot be edited: %',k; end if;
  end loop;
  if p_patch='{}'::jsonb then raise exception 'Enter a correction'; end if;
  execute format('select branch_id from public.%I where id=$1 and deleted_at is null for update',q.table_name) into target_branch using p_record;
  if target_branch is distinct from q.branch_id then raise exception 'Record is not accessible'; end if;
  if q.table_name in ('interactions','cp_interactions') then
   guard_name:=q.table_name||'_history_guard';
   execute format('alter table public.%I disable trigger %I',q.table_name,guard_name);
  end if;
  select string_agg(format('%1$I=x.%1$I',key),',') into cols from jsonb_object_keys(p_patch) key;
  execute format('update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I,$1) x where t.id=$2',q.table_name,cols) using p_patch,p_record;
  if guard_name is not null then
   execute format('alter table public.%I enable trigger %I',q.table_name,guard_name);
   if q.table_name='interactions' then
    perform refresh_lead_from_interactions(lead_id) from interactions where id=p_record;
   else perform refresh_cp_from_interactions(cp_id) from cp_interactions where id=p_record;
   end if;
  end if;
 elsif p_action in ('keep_a','keep_b','both_valid') then
  if q.issue_type<>'plot_double_booked' or cardinality(q.record_ids)<>2 then raise exception 'Not a two-booking conflict'; end if;
  if p_action<>'both_valid' then
   update bookings set deleted_at=now(),remarks=concat_ws(E'\n',remarks,'Superseded by quality decision '||q.legacy_key)
    where id=q.record_ids[case when p_action='keep_a' then 2 else 1 end] and branch_id=q.branch_id;
  end if;
 elsif p_action<>'ok' then raise exception 'Unknown quality action';
 end if;
 update data_quality_issues set status=case when p_action in ('ok','both_valid') then 'accepted' else 'resolved' end,
 resolved_by=auth.uid(),resolved_at=now(),resolution=p_action||case when p_action='fix' then ': '||p_patch::text else '' end where id=q.id;
end $$;
revoke all on function public.resolve_quality_issue(uuid,text,uuid,jsonb,uuid) from public,anon;
grant execute on function public.resolve_quality_issue(uuid,text,uuid,jsonb,uuid) to authenticated;

-- History filter uses the same dashboard definitions; defaults keep existing callers valid.
drop function public.team_metrics(date,date);
drop function public.associate_metrics(date,date);
create or replace function public.associate_metrics(p_from date, p_to date, p_include_historical boolean default true)
returns table (
  associate_id uuid, associate_name text,
  customer_meetings int, leads_met int, hot_leads int, warm_leads int, cold_leads int, hot_pct numeric,
  cps_met int, cp_active int, cp_hot int, cp_warm int, cp_cold int,
  bookings int, booking_value numeric,
  tokens int, token_value numeric,
  cancelled int, cancelled_value numeric
)
language sql stable security invoker set search_path = public as $$
  with people as (
    select p.id, p.full_name from public.profiles p
     where p.deleted_at is null and p.active and p.role in ('associate', 'team_lead')
  ),
  mtg as (
    select i.associate_id, i.lead_id, i.rating_after, i.occurred_on, i.created_at
      from public.interactions i
     where i.deleted_at is null and (p_include_historical or not i.is_historical) and i.interaction_type = 'meeting' and i.occurred_on between p_from and p_to
  ),
  mtg_last as (
    select distinct on (associate_id, lead_id) associate_id, lead_id, rating_after
      from mtg order by associate_id, lead_id, occurred_on desc, created_at desc
  ),
  m as (
    select associate_id,
           (select count(*) from mtg x where x.associate_id = l.associate_id)::int as meetings,
           count(*)::int as leads_met,
           count(*) filter (where rating_after = 'hot')::int  as hot_leads,
           count(*) filter (where rating_after = 'warm')::int as warm_leads,
           count(*) filter (where rating_after = 'cold')::int as cold_leads
      from mtg_last l group by associate_id
  ),
  cpi as (
    select c.associate_id, c.cp_id, c.rating_after, c.occurred_on, c.created_at
      from public.cp_interactions c
     where c.deleted_at is null and (p_include_historical or not c.is_historical) and c.occurred_on between p_from and p_to
  ),
  cp_last as (
    select distinct on (associate_id, cp_id) associate_id, cp_id, rating_after
      from cpi order by associate_id, cp_id, occurred_on desc, created_at desc
  ),
  c as (
    select associate_id, count(*)::int as cps_met,
           count(*) filter (where rating_after = 'active')::int as cp_active,
           count(*) filter (where rating_after = 'hot')::int    as cp_hot,
           count(*) filter (where rating_after = 'warm')::int   as cp_warm,
           count(*) filter (where rating_after = 'cold')::int   as cp_cold
      from cp_last group by associate_id
  ),
  b as (
    select associate_id,
           count(*) filter (where status in ('booking_done', 'agreement_signed'))::int as bookings,
           coalesce(sum(value) filter (where status in ('booking_done', 'agreement_signed')), 0) as booking_value,
           count(*) filter (where status = 'token')::int as tokens,
           coalesce(sum(value) filter (where status = 'token'), 0) as token_value,
           count(*) filter (where status = 'cancelled')::int as cancelled,
           coalesce(sum(value) filter (where status = 'cancelled'), 0) as cancelled_value
      from public.bookings
     where deleted_at is null and (p_include_historical or not is_historical) and booking_date between p_from and p_to
     group by associate_id
  )
  select p.id, p.full_name,
         coalesce(m.meetings, 0), coalesce(m.leads_met, 0),
         coalesce(m.hot_leads, 0), coalesce(m.warm_leads, 0), coalesce(m.cold_leads, 0),
         case when coalesce(m.leads_met, 0) = 0 then 0 else round(m.hot_leads::numeric / m.leads_met, 4) end,
         coalesce(c.cps_met, 0), coalesce(c.cp_active, 0), coalesce(c.cp_hot, 0), coalesce(c.cp_warm, 0), coalesce(c.cp_cold, 0),
         coalesce(b.bookings, 0), coalesce(b.booking_value, 0),
         coalesce(b.tokens, 0), coalesce(b.token_value, 0),
         coalesce(b.cancelled, 0), coalesce(b.cancelled_value, 0)
    from people p
    left join m on m.associate_id = p.id
    left join c on c.associate_id = p.id
    left join b on b.associate_id = p.id
   where p.id in (select public.visible_associates())
   order by p.full_name
$$;

-- ---------------------------------------------------------------- totals for the people the caller can see
create or replace function public.team_metrics(p_from date, p_to date, p_include_historical boolean default true)
returns table (
  customer_meetings int, leads_met int, hot_leads int, warm_leads int, cold_leads int, hot_pct numeric,
  cps_met int, cp_active int, cp_hot int, cp_warm int, cp_cold int,
  bookings int, booking_value numeric, tokens int, token_value numeric, cancelled int, cancelled_value numeric
)
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(customer_meetings), 0)::int, coalesce(sum(leads_met), 0)::int,
         coalesce(sum(hot_leads), 0)::int, coalesce(sum(warm_leads), 0)::int, coalesce(sum(cold_leads), 0)::int,
         case when coalesce(sum(leads_met), 0) = 0 then 0 else round(sum(hot_leads)::numeric / sum(leads_met), 4) end,
         coalesce(sum(cps_met), 0)::int, coalesce(sum(cp_active), 0)::int, coalesce(sum(cp_hot), 0)::int,
         coalesce(sum(cp_warm), 0)::int, coalesce(sum(cp_cold), 0)::int,
         coalesce(sum(bookings), 0)::int, coalesce(sum(booking_value), 0),
         coalesce(sum(tokens), 0)::int, coalesce(sum(token_value), 0),
         coalesce(sum(cancelled), 0)::int, coalesce(sum(cancelled_value), 0)
    from public.associate_metrics(p_from, p_to, p_include_historical)
$$;

grant execute on function public.current_review_period(date), public.associate_metrics(date, date, boolean),
                          public.team_metrics(date, date, boolean) to authenticated, service_role;

revoke execute on function public.current_review_period(date), public.associate_metrics(date, date, boolean),
                           public.team_metrics(date, date, boolean) from public, anon;
