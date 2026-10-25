-- PostgreSQL RLS controls rows, not columns. Remove direct access to structured
-- customer contacts and source JSON; a checked RPC returns them only to owner/admin.
do $$ declare tab text;cols text;begin
 foreach tab in array array['leads','interactions','bookings'] loop
  execute format('revoke select on public.%I from authenticated',tab);
  select string_agg(quote_ident(column_name),',') into cols from information_schema.columns where table_schema='public' and table_name=tab and column_name<>'raw_json' and not(tab='leads' and column_name='phone');
  execute format('grant select(%s) on public.%I to authenticated',cols,tab);
 end loop;
end $$;
create function public.record_read(p_table text,p_ids uuid[] default null,p_owner uuid default null,p_offset integer default 0,p_limit integer default 1000,p_include_deleted boolean default false) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare me profiles:=review_actor();owner_col text;scope text;owner_scope text;r record;data jsonb;result jsonb:='[]';private boolean;begin
 if p_table<>all(array['leads','interactions','bookings','cp_interactions','channel_partners']) then raise exception 'Table is not readable';end if;
 owner_col:=case p_table when 'leads' then 'owner_id' when 'channel_partners' then 'created_by' else 'associate_id' end;
 scope:=case when p_table='leads' then '(t.owner_id in(select visible_associates()) or(is_reviewer() and t.branch_id=my_branch() and review_has_lead_history(t.id)))' when p_table='channel_partners' then '(t.branch_id=my_branch() or my_role()=''super_admin'')' else format('(t.%I in(select visible_associates())',owner_col)||case when p_table in('interactions','bookings') then ' or exists(select 1 from leads l where l.id=t.lead_id and l.owner_id=auth.uid())' else '' end||')' end;
 owner_scope:=format('($2 is null or t.%I=$2',owner_col)||case when p_table in('interactions','bookings') then ' or exists(select 1 from leads l where l.id=t.lead_id and l.owner_id=$2)' else '' end||')';
 for r in execute format('select to_jsonb(t) j from public.%I t where %s and($1 is null or t.id=any($1)) and %s and($3 or t.deleted_at is null) order by t.id limit $4 offset $5',p_table,scope,owner_scope) using p_ids,p_owner,p_include_deleted,least(greatest(p_limit,1),1000),greatest(p_offset,0) loop
  data:=r.j;if p_table in('interactions','bookings') then select owner_id::text into owner_scope from leads where id=(data->>'lead_id')::uuid;else owner_scope:=data->>owner_col;end if;private:=owner_scope=me.id::text or(me.role in('branch_admin','super_admin') and(me.role='super_admin' or data->>'branch_id'=me.branch_id::text));
  if not coalesce(private,false) then data:=data-'phone'-'raw_json';end if;
  result:=result||jsonb_build_array(data);
 end loop;return result;
end $$;
revoke all on function public.record_read(text,uuid[],uuid,integer,integer,boolean) from public,anon;
grant execute on function public.record_read(text,uuid[],uuid,integer,integer,boolean) to authenticated;

-- Preserve the pipeline definition while selecting only its required columns.
create or replace function public.analysis_pipeline(p_filters jsonb,p_to date) returns jsonb
language sql stable security invoker set search_path=public as $$
 with bounds as(select least(p_to,(now() at time zone 'Asia/Kolkata')::date) asof),
 leads_at as(select * from analysis_rows('leads',p_filters-'q'-'dimensions',null,(select asof from bounds))),
 state as(select l.*,case when last_i.id is not null then last_i.rating_after::text when not exists(select 1 from interactions i where i.lead_id=l.lead_id and i.deleted_at is null) then l.rating end stage,
 coalesce(last_i.occurred_on,l.happened_on) touched,case when last_i.id is not null then last_i.next_action_date else l.next_action_date end due,
 coalesce(last_plot.plot_names,'{}') plots from leads_at l
 left join lateral(select i.id,i.rating_after,i.occurred_on,i.next_action_date from interactions i where i.lead_id=l.lead_id and i.deleted_at is null and i.occurred_on<=(select asof from bounds) order by i.occurred_on desc,i.created_at desc,i.id desc limit 1) last_i on true
 left join lateral(select plot_names from interactions i where i.lead_id=l.lead_id and i.deleted_at is null and cardinality(plot_names)>0 and i.occurred_on<=(select asof from bounds) order by i.occurred_on desc,i.created_at desc,i.id desc limit 1) last_plot on true)
 select coalesce(jsonb_agg(jsonb_build_object('id',lead_id,'name',lead_name,'owner_id',associate_id,'owner',associate_name,'rating',stage,'plots',plots,'age_days',(select asof from bounds)-touched,'next_action_date',due,'overdue',due<(select asof from bounds),'status',status) order by (select asof from bounds)-touched desc,lead_id),'[]')
 from state where stage in('hot','warm','cold') and status<>'lost' and not exists(select 1 from bookings b where b.lead_id=state.lead_id and b.deleted_at is null and b.status in('booking_done','agreement_signed') and (b.booking_date<=(select asof from bounds) or(b.booking_date is null and (select asof from bounds)=(now() at time zone 'Asia/Kolkata')::date)))
$$;


-- Old entry receipts contain before/after contact details. The queue needs only RPCs,
-- never these payloads, so do not expose them through PostgREST.
revoke select on public.entry_receipts from authenticated;
grant select(id,associate_id,kind,table_name,record_id,lead_id,cp_id,created_at,undone_at) on public.entry_receipts to authenticated;

-- A temporary-password session may read its own profile for the password-change
-- screen, but cannot access operational data through the REST API beforehand.
create or replace function public.my_role() returns public.user_role language sql stable security definer set search_path=public as $$select role from profiles where id=auth.uid() and active and deleted_at is null and not must_change_password$$;
create or replace function public.my_branch() returns uuid language sql stable security definer set search_path=public as $$select branch_id from profiles where id=auth.uid() and active and deleted_at is null and not must_change_password$$;
create policy profile_password_gate on public.profiles as restrictive for select to authenticated using(id=(select auth.uid()) or(select my_role()) is not null);
do $$declare tab text;begin
 foreach tab in array array['projects','cold_reasons','next_action_types','review_cycle','channel_partners','leads','interactions','cp_interactions','bookings','booking_status_history','targets','review_sessions','review_actions','cp_firms','data_quality_issues','entry_receipts','entry_cancellations','saved_analysis_views','review_rules'] loop
  execute format('create policy password_setup_gate on public.%I as restrictive for all to authenticated using((select my_role()) is not null) with check((select my_role()) is not null)',tab);
 end loop;
end $$;
create function public.password_setup_guard() returns trigger language plpgsql security definer set search_path=public as $$begin
 if auth.uid() is not null and new.must_change_password is distinct from old.must_change_password then raise exception 'Password setup can be completed only through the secure password screen' using errcode='42501';end if;return new;
end $$;
create trigger password_setup_guard before update of must_change_password on public.profiles for each row execute function password_setup_guard();
create function public.customer_owner_guard() returns trigger language plpgsql security definer set search_path=public as $$begin
 if auth.uid() is not null and(new.owner_id is distinct from old.owner_id or new.phone is distinct from old.phone) and not is_admin() and old.owner_id<>auth.uid() then raise exception 'Only the owner or an admin can change customer contact details' using errcode='42501';end if;
 if auth.uid() is not null and new.owner_id is distinct from old.owner_id and not is_admin() then raise exception 'Only an admin can reassign customers' using errcode='42501';end if;return new;
end $$;
create trigger customer_owner_guard before update of phone,owner_id on public.leads for each row execute function customer_owner_guard();

-- Keep explicit scope even when a checked review finalisation calls this as a definer.
create or replace function public.analysis_rows(p_dataset text,p_filters jsonb,p_from date default null,p_to date default null)
returns setof public.analysis_events language sql stable security invoker set search_path=public as $$
 select e.* from analysis_events e where is_reviewer() and e.associate_id in(select visible_associates()) and (p_dataset='all' or e.dataset=p_dataset)
 and (p_dataset<>'meetings' or e.interaction_type='meeting')
 and (p_from is null or e.happened_on>=p_from) and (p_to is null or e.happened_on<=p_to)
 and (nullif(p_filters->>'branch','') is null or e.branch_id=(p_filters->>'branch')::uuid)
 and (coalesce(jsonb_array_length(p_filters->'associates'),0)=0 or e.associate_id::text in (select jsonb_array_elements_text(p_filters->'associates')))
 and (nullif(p_filters->>'project','') is null or e.project_id=(p_filters->>'project')::uuid)
 and (nullif(p_filters->>'source','') is null or e.source=p_filters->>'source')
 and (nullif(p_filters->>'cp','') is null or e.cp_id=(p_filters->>'cp')::uuid)
 and (nullif(p_filters->>'firm','') is null or coalesce(e.firm_id::text,e.firm_name)=p_filters->>'firm')
 and (coalesce(p_filters->>'history','all')='all' or e.is_historical=(p_filters->>'history'='only'))
 and not exists(select 1 from jsonb_each(coalesce(p_filters->'dimensions','{}')) d where
   case when jsonb_typeof(d.value)='array' then not(analysis_dimension(e,d.key)=any(array(select jsonb_array_elements_text(d.value)))) else analysis_dimension(e,d.key)<>(d.value#>>'{}') end)
 and (nullif(trim(p_filters->>'q'),'') is null or e.search_document@@websearch_to_tsquery('simple',p_filters->>'q') or
  (e.dataset='leads' and exists(select 1 from interactions i where i.lead_id=e.lead_id and i.deleted_at is null and i.remark_tsv@@websearch_to_tsquery('simple',p_filters->>'q'))))
$$;


-- Transferring current ownership must not erase the original team's meeting or
-- booking credit when analysis joins a historical fact back to its customer.
create function public.review_has_lead_history(p_lead uuid) returns boolean language sql stable security definer set search_path=public as $$
 select is_reviewer() and(exists(select 1 from interactions where lead_id=p_lead and deleted_at is null and associate_id in(select visible_associates())) or exists(select 1 from bookings where lead_id=p_lead and deleted_at is null and associate_id in(select visible_associates())))
$$;
revoke all on function public.review_has_lead_history(uuid) from public,anon;
grant execute on function public.review_has_lead_history(uuid) to authenticated;
create policy reviewed_customer_history on public.leads for select to authenticated using((select is_reviewer()) and branch_id=(select my_branch()) and review_has_lead_history(id));
