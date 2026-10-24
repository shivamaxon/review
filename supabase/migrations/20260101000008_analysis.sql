-- One fact vocabulary for analysis. Invoker views preserve base-table RLS.
create view public.analysis_events with (security_invoker=true) as
select 'meetings'::text dataset,i.id,i.branch_id,i.associate_id,p.full_name associate_name,p.reports_to team_id,manager.full_name team_name,
 coalesce(i.project_id,l.project_id) project_id,pr.name project_name,l.source::text source,l.cp_id,c.name cp_name,
 coalesce(c.firm_id,f.id) firm_id,coalesce(f.name,c.firm,l.cp_firm_name,'Unattributed') firm_name,
 l.id lead_id,l.name lead_name,i.occurred_on happened_on,i.created_at,i.rating_after::text rating,i.rating_before::text rating_before,
 null::text status,null::numeric value,i.mode::text mode,i.cold_reason,i.remark,i.remark_tsv search_document,
 i.next_action,i.next_action_date,i.plot_names,i.is_historical,i.interaction_type::text interaction_type,i.date_estimated,
 null::text cancel_reason
from interactions i join leads l on l.id=i.lead_id join profiles p on p.id=i.associate_id and p.deleted_at is null and p.active and p.role in ('associate','team_lead')
left join profiles manager on manager.id=p.reports_to left join projects pr on pr.id=coalesce(i.project_id,l.project_id)
left join channel_partners c on c.id=l.cp_id left join cp_firms f on f.branch_id=l.branch_id and f.deleted_at is null and (f.id=c.firm_id or (c.firm_id is null and lower(f.name)=lower(l.cp_firm_name))) where i.deleted_at is null
union all
select 'cp_meetings',i.id,i.branch_id,i.associate_id,p.full_name,p.reports_to,manager.full_name,null,null,'cp',c.id,c.name,c.firm_id,coalesce(f.name,c.firm,'Independent'),
 null,c.name,i.occurred_on,i.created_at,i.rating_after::text,i.rating_before::text,null,null,i.mode::text,null,i.remark,i.remark_tsv,i.next_action,i.next_action_date,'{}'::text[],i.is_historical,'meeting',i.date_estimated,null
from cp_interactions i join channel_partners c on c.id=i.cp_id join profiles p on p.id=i.associate_id and p.deleted_at is null and p.active and p.role in ('associate','team_lead')
left join profiles manager on manager.id=p.reports_to left join cp_firms f on f.id=c.firm_id where i.deleted_at is null
union all
select 'bookings',b.id,b.branch_id,b.associate_id,p.full_name,p.reports_to,manager.full_name,b.project_id,pr.name,b.source::text,b.cp_id,c.name,coalesce(c.firm_id,f.id),coalesce(f.name,c.firm,b.cp_firm_name,'Unattributed'),
 l.id,l.name,b.booking_date,b.created_at,l.current_rating::text,null,b.status::text,b.value,null,null,concat_ws(E'\n',b.remarks,b.cancel_reason),b.remarks_tsv,null,null,array_remove(array[b.plot_no],null),b.is_historical,null,false,b.cancel_reason
from bookings b join leads l on l.id=b.lead_id join profiles p on p.id=b.associate_id and p.deleted_at is null and p.active and p.role in ('associate','team_lead')
left join profiles manager on manager.id=p.reports_to left join projects pr on pr.id=b.project_id left join channel_partners c on c.id=b.cp_id left join cp_firms f on f.legacy_key=b.cp_firm_key where b.deleted_at is null
union all
select 'leads',l.id,l.branch_id,l.owner_id,p.full_name,p.reports_to,manager.full_name,l.project_id,pr.name,l.source::text,l.cp_id,c.name,coalesce(c.firm_id,f.id),coalesce(f.name,c.firm,l.cp_firm_name,'Unattributed'),
 l.id,l.name,coalesce(l.created_on,(l.created_at at time zone 'Asia/Kolkata')::date),l.created_at,l.current_rating::text,null,l.status,null,null,l.cold_reason,
 coalesce(last_i.remark,l.next_action),to_tsvector('simple',coalesce(last_i.remark,l.next_action,'')),l.next_action,l.next_action_date,l.plot_names,l.is_historical,null,false,null
from leads l join profiles p on p.id=l.owner_id and p.deleted_at is null and p.active and p.role in ('associate','team_lead')
left join profiles manager on manager.id=p.reports_to left join projects pr on pr.id=l.project_id left join channel_partners c on c.id=l.cp_id
left join cp_firms f on f.branch_id=l.branch_id and f.deleted_at is null and (f.id=c.firm_id or (c.firm_id is null and lower(f.name)=lower(l.cp_firm_name)))
left join lateral(select remark from interactions where lead_id=l.id and deleted_at is null order by occurred_on desc,created_at desc,id desc limit 1) last_i on true where l.deleted_at is null;
grant select on public.analysis_events to authenticated,service_role;

create function public.analysis_cycle(p_day date,p_branch uuid) returns table(date_from date,date_to date,label text)
language sql stable security invoker set search_path=public as $$
 with month as(select date_trunc('month',p_day)::date first,(date_trunc('month',p_day)+interval '1 month - 1 day')::date last), configured as(
 select first+rc.start_day-1 a,least(coalesce(first+rc.end_day-1,last),last) b,rc.label l from month,review_cycle rc
 where rc.branch_id=p_branch and rc.deleted_at is null and p_day between first+rc.start_day-1 and least(coalesce(first+rc.end_day-1,last),last) order by rc.sort_order limit 1)
 select a,b,l from configured union all select first+case when extract(day from p_day)<=10 then 0 when extract(day from p_day)<=20 then 10 else 20 end,
 least(first+case when extract(day from p_day)<=10 then 9 when extract(day from p_day)<=20 then 19 else 30 end,last),'Review cycle' from month where not exists(select 1 from configured)
$$;
create function public.analysis_context(p_filters jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare today date:=(now() at time zone 'Asia/Kolkata')::date; a date;b date;pa date;pb date;l text; mode text:=coalesce(p_filters->>'window','cycle'); branch uuid:=coalesce(nullif(p_filters->>'branch','')::uuid,my_branch());
begin
 select date_from,date_to,label into a,b,l from analysis_cycle(today,branch);
 if mode='last_cycle' then select date_from,date_to,label into a,b,l from analysis_cycle(a-1,branch);
 elsif mode='last10' then a:=today-9;b:=today;l:='Last 10 days';
 elsif mode='mtd' then a:=date_trunc('month',today)::date;b:=today;l:='Month to date';
 elsif mode='custom' then a:=coalesce(nullif(p_filters->>'from','')::date,a);b:=coalesce(nullif(p_filters->>'to','')::date,b);l:='Custom';end if;
 if a>b then raise exception 'Start date must be on or before end date';end if;
 if mode in ('cycle','last_cycle') then select date_from,date_to into pa,pb from analysis_cycle(a-1,branch);
 elsif mode='mtd' then pa:=(a-interval '1 month')::date;pb:=least(pa+(b-a),(a-1));
 else pa:=a-(b-a+1);pb:=a-1;end if;
 return jsonb_build_object('from',a,'to',b,'previous_from',pa,'previous_to',pb,'label',l);
end $$;

create function public.analysis_dimension(e public.analysis_events,p_dim text,p_label boolean default false) returns text
language sql stable security invoker set search_path=public as $$
 select coalesce(case p_dim when 'associate' then case when p_label then e.associate_name else e.associate_id::text end
 when 'team' then case when p_label then e.team_name else e.team_id::text end
 when 'project' then case when p_label then e.project_name else e.project_id::text end
 when 'source' then e.source when 'cp' then case when p_label then e.cp_name else e.cp_id::text end
 when 'firm' then case when p_label then e.firm_name else coalesce(e.firm_id::text,e.firm_name) end
 when 'rating' then e.rating when 'week' then to_char(date_trunc('week',e.happened_on),'YYYY-MM-DD')
 when 'month' then to_char(e.happened_on,'YYYY-MM') when 'cold_reason' then e.cold_reason when 'mode' then e.mode
 when 'cancel_reason' then nullif(trim(e.cancel_reason),'') when 'status' then e.status when 'branch' then e.branch_id::text end,case when p_label then 'Not recorded' else '__none__' end)
$$;
create function public.analysis_rows(p_dataset text,p_filters jsonb,p_from date default null,p_to date default null)
returns setof public.analysis_events language sql stable security invoker set search_path=public as $$
 select e.* from analysis_events e where is_reviewer() and (p_dataset='all' or e.dataset=p_dataset)
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

-- Pipeline is a snapshot as of the end date, rather than only newly created leads.
create function public.analysis_pipeline(p_filters jsonb,p_to date) returns jsonb
language sql stable security invoker set search_path=public as $$
 with bounds as(select least(p_to,(now() at time zone 'Asia/Kolkata')::date) asof),
 leads_at as(select * from analysis_rows('leads',p_filters-'q'-'dimensions',null,(select asof from bounds))),
 state as(select l.*,case when last_i.id is not null then last_i.rating_after::text when not exists(select 1 from interactions i where i.lead_id=l.lead_id and i.deleted_at is null) then l.rating end stage,
 coalesce(last_i.occurred_on,l.happened_on) touched,case when last_i.id is not null then last_i.next_action_date else l.next_action_date end due,
 coalesce(last_plot.plot_names,'{}') plots from leads_at l
 left join lateral(select * from interactions i where i.lead_id=l.lead_id and i.deleted_at is null and i.occurred_on<=(select asof from bounds) order by i.occurred_on desc,i.created_at desc,i.id desc limit 1) last_i on true
 left join lateral(select plot_names from interactions i where i.lead_id=l.lead_id and i.deleted_at is null and cardinality(plot_names)>0 and i.occurred_on<=(select asof from bounds) order by i.occurred_on desc,i.created_at desc,i.id desc limit 1) last_plot on true)
 select coalesce(jsonb_agg(jsonb_build_object('id',lead_id,'name',lead_name,'owner_id',associate_id,'owner',associate_name,'rating',stage,'plots',plots,'age_days',(select asof from bounds)-touched,'next_action_date',due,'overdue',due<(select asof from bounds),'status',status) order by (select asof from bounds)-touched desc,lead_id),'[]')
 from state where stage in('hot','warm','cold') and status<>'lost' and not exists(select 1 from bookings b where b.lead_id=state.lead_id and b.deleted_at is null and b.status in('booking_done','agreement_signed') and (b.booking_date<=(select asof from bounds) or(b.booking_date is null and (select asof from bounds)=(now() at time zone 'Asia/Kolkata')::date)))
$$;

create function public.analysis_metric_rows(p_metric text,p_filters jsonb,p_from date,p_to date,p_basis text default 'numerator')
returns setof public.analysis_events language sql stable security invoker set search_path=public as $$
 with m as materialized(select * from analysis_rows('meetings',p_filters,p_from,p_to)),
 last_m as(select distinct on(associate_id,lead_id) * from m order by associate_id,lead_id,happened_on desc,created_at desc,id desc),
 cp as(select distinct on(cp_id) * from analysis_rows('cp_meetings',p_filters,p_from,p_to) order by cp_id,happened_on desc,created_at desc,id desc),
 b as materialized(select * from analysis_rows('bookings',p_filters,p_from,p_to))
 select * from m where p_metric='customer_meetings'
 union all select * from m i where (p_metric='dated_actions_pct' and next_action is not null and(p_basis='denominator' or next_action_date is not null)) or(p_metric='on_time_pct' and next_action_date is not null and next_action_date<=p_to and(p_basis='denominator' or exists(select 1 from interactions n where n.lead_id=i.lead_id and n.associate_id=i.associate_id and n.deleted_at is null and(n.occurred_on,n.created_at,n.id)>(i.happened_on,i.created_at,i.id) and n.occurred_on<=i.next_action_date)))
 union all select * from last_m where (p_metric='leads_met' or (p_metric='hot_pct' and p_basis='denominator')) or
 (p_metric in('hot_leads','hot_pct') and rating='hot') or (p_metric in('hot_conversion','hot_token','hot_booked','hot_agreement') and rating='hot' and ((p_metric='hot_conversion' and p_basis='denominator') or exists(select 1 from b where b.lead_id=last_m.lead_id and b.happened_on>=(select min(happened_on) from m where lead_id=last_m.lead_id and rating='hot') and case when p_metric='hot_token' then b.status in('token','booking_done','agreement_signed') when p_metric='hot_agreement' then b.status='agreement_signed' else b.status in('booking_done','agreement_signed') end))) or(p_metric='warm_leads' and rating='warm') or(p_metric='cold_leads' and rating='cold')
 union all select l.* from analysis_rows('leads',p_filters,null,p_to) l where p_metric='hot_stale7' and exists(select 1 from jsonb_array_elements(analysis_pipeline(p_filters,p_to)) p where p->>'id'=l.lead_id::text and p->>'rating'='hot' and(p->>'age_days')::int>=7)
 union all select * from analysis_rows('cp_meetings',p_filters,p_from,p_to) where p_metric='cp_meetings'
 union all select * from cp where (p_metric='active_cps' and rating='active') or p_metric='cps_met'
 union all select * from b where (p_metric in('bookings','booking_value') and status in('booking_done','agreement_signed')) or(p_metric='tokens' and status='token') or
 (p_metric in('cancellations','cancellation_pct') and (status='cancelled' or p_basis='denominator')) or(p_metric='agreements' and status='agreement_signed')
$$;

create function public.analysis_drill(p_metric text,p_filters jsonb,p_offset integer default 0,p_limit integer default 50,p_basis text default 'numerator') returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare c jsonb:=analysis_context(p_filters);a date:=(c->>'from')::date;b date:=(c->>'to')::date;result jsonb;
begin
 if not is_reviewer() then raise exception 'Reviewer access required' using errcode='42501';end if;
 if p_metric like 'funnel:%' then
  with prior as materialized(select * from analysis_metric_rows(split_part(p_metric,':',2),p_filters,a,b)),
  next as materialized(select * from analysis_metric_rows(split_part(p_metric,':',3),p_filters,a,b)),
  members as materialized(select * from next where p_basis='numerator' union all select * from prior where p_basis='denominator' or(p_basis='dropoff' and not exists(select 1 from next n where n.lead_id=prior.lead_id))),
  page as(select * from members order by happened_on desc,id limit least(greatest(p_limit,1),500) offset greatest(p_offset,0))
  select jsonb_build_object('total',(select count(*) from members),'rows',coalesce((select jsonb_agg(to_jsonb(page)-'search_document') from page),'[]')) into result;return result;
 end if;
 if p_metric like 'explorer:%' then
  with selected as(select array_agg(e) rows from analysis_rows(split_part(p_metric,':',2),p_filters,a,b) e),facts as(select array_agg(e) rows from analysis_rows('all',p_filters-'dimensions'-'q',a,b) e),
  members as materialized(select r.* from selected,facts,analysis_group_members(selected.rows,facts.rows,split_part(p_metric,':',2),a,b,split_part(p_metric,':',3),p_basis) r),page as(select * from members order by happened_on desc nulls last,id limit least(greatest(p_limit,1),500) offset greatest(p_offset,0))
  select jsonb_build_object('total',(select count(*) from members),'rows',coalesce((select jsonb_agg(to_jsonb(page)-'search_document') from page),'[]'),'value',(select coalesce(sum(value),0) from members)) into result;return result;
 end if;
 if p_metric like 'duration:%' then
  with samples as materialized(select e.*,t.next_day-t.happened_on duration_days,t.next_day stage_ended_on from analysis_transitions(p_filters,b) t join analysis_events e on e.id=t.record_id and e.dataset=t.dataset where t.stage=split_part(p_metric,':',2) and t.next_day between a and b),page as(select * from samples order by stage_ended_on desc,id limit least(greatest(p_limit,1),500) offset greatest(p_offset,0))
  select jsonb_build_object('total',(select count(*) from samples),'rows',coalesce((select jsonb_agg(to_jsonb(page)-'search_document') from page),'[]'),'average_days',(select round(avg(duration_days),2) from samples)) into result;return result;
 end if;
 if p_metric like 'transition:%' then
  with all_rows as(select e.*,t.previous transition_from,t.stage transition_to,t.happened_on transition_date,t.id transition_id from analysis_transitions(p_filters,b) t join analysis_events e on e.id=t.record_id and e.dataset=t.dataset
   where t.happened_on between a and b and coalesce(t.previous,'new')=split_part(p_metric,':',2) and t.stage=split_part(p_metric,':',3)),page as(select * from all_rows order by transition_date desc,transition_id limit least(greatest(p_limit,1),500) offset greatest(p_offset,0))
  select jsonb_build_object('total',(select count(*) from all_rows),'rows',coalesce((select jsonb_agg(to_jsonb(page)-'search_document') from page),'[]')) into result;return result;
 end if;
 if p_metric='booking_target' then
  select jsonb_build_object('total',count(*),'targets',coalesce(jsonb_agg(jsonb_build_object('id',t.id,'month',t.month,'associate',p.full_name,'monthly',t.bookings,'allocated',round(t.bookings::numeric*(least(b,(t.month+interval '1 month - 1 day')::date)-greatest(a,t.month)+1)/extract(day from t.month+interval '1 month - 1 day'),4))),'[]')) into result from targets t join profiles p on p.id=t.associate_id
   where t.deleted_at is null and t.month<=b and(t.month+interval '1 month - 1 day')::date>=a and(coalesce(jsonb_array_length(p_filters->'associates'),0)=0 or t.associate_id::text in(select jsonb_array_elements_text(p_filters->'associates'))) and(nullif(p_filters->>'branch','') is null or t.branch_id=(p_filters->>'branch')::uuid);return result;
 end if;
 with rows as materialized(select * from analysis_metric_rows(p_metric,p_filters,a,b,p_basis)),page as(select * from rows order by happened_on desc nulls last,id limit least(greatest(p_limit,1),500) offset greatest(p_offset,0))
 select jsonb_build_object('total',(select count(*) from rows),'rows',coalesce((select jsonb_agg(to_jsonb(page)-'search_document'||jsonb_build_object('snippet',case when nullif(p_filters->>'q','') is not null then ts_headline('simple',coalesce(remark,''),websearch_to_tsquery('simple',p_filters->>'q'),'StartSel=⟪,StopSel=⟫,MaxFragments=2,MaxWords=25,MinWords=5') else left(remark,200) end)) from page),'[]'),'offset',p_offset,'limit',p_limit) into result;
 return result;
end $$;

-- Explorer computes globally sorted group measures before returning a bounded page.
create function public.analysis_group_summary(p_group public.analysis_events[],p_facts public.analysis_events[],p_dataset text,p_from date,p_to date) returns jsonb
language sql stable security invoker set search_path=public as $$
 with e as materialized(select * from unnest(p_group) where happened_on between p_from and p_to),
 facts as materialized(select * from unnest(p_facts) where happened_on between p_from and p_to),
 cohort as(select distinct lead_id from e where lead_id is not null union select l.lead_id from facts l where l.dataset='leads' and p_dataset='cp_meetings' and l.source='cp' and exists(select 1 from e where e.cp_id=l.cp_id or(e.firm_id is not null and e.firm_id=l.firm_id))),
 last_m as(select distinct on(i.associate_id,i.lead_id) i.* from facts i where i.dataset='meetings' and i.interaction_type='meeting' and i.lead_id in(select lead_id from cohort) and(p_dataset<>'meetings' or i.id in(select id from e)) order by i.associate_id,i.lead_id,i.happened_on desc,i.created_at desc,i.id desc),
 books as materialized(select x.* from facts x where x.dataset='bookings' and((p_dataset in('bookings','all') and x.id in(select id from e where dataset='bookings')) or(p_dataset not in('bookings','all') and(x.lead_id in(select lead_id from cohort) or(p_dataset='cp_meetings' and exists(select 1 from e where e.cp_id=x.cp_id or(e.firm_id is not null and e.firm_id=x.firm_id))))))),
 counts as(select count(*) n,(select count(*) from cohort) leads from e),bc as(select count(*) all_units,count(*) filter(where status in('booking_done','agreement_signed')) units,coalesce(sum(value) filter(where status in('booking_done','agreement_signed')),0) value,count(*) filter(where status='cancelled') cancelled,count(distinct lead_id) filter(where status in('booking_done','agreement_signed')) converted from books)
 select jsonb_build_object('count',n,'unique_leads',leads,'hot_pct',coalesce((select round(100.0*count(*) filter(where rating='hot')/nullif(count(*),0),2) from last_m),0),
 'booking_units',units,'value',value,'cancellation_pct',coalesce(round(100.0*cancelled/nullif(all_units,0),2),0),'conversion_pct',coalesce(round(100.0*converted/nullif(leads,0),2),0),'average_ticket',case when units>0 then round(value/units,2) end,
 'average_days_to_close',(select round(avg(b.happened_on-coalesce(l.created_on,(l.created_at at time zone 'Asia/Kolkata')::date)),2) from books b join leads l on l.id=b.lead_id where b.status in('booking_done','agreement_signed') and b.happened_on>=coalesce(l.created_on,(l.created_at at time zone 'Asia/Kolkata')::date))) from counts,bc
$$;
create function public.analysis_explore(p_dataset text,p_filters jsonb,p_groups text[] default '{}',p_measures text[] default array['count'],p_offset integer default 0,p_limit integer default 50,p_sort text default 'count') returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare c jsonb:=analysis_context(p_filters);a date:=(c->>'from')::date;b date:=(c->>'to')::date;pa date:=(c->>'previous_from')::date;pb date:=(c->>'previous_to')::date;
 facts public.analysis_events[];selected public.analysis_events[];subset public.analysis_events[];g record;m jsonb;prev jsonb;result jsonb:='[]';total integer;item jsonb;sort_key text;
begin
 if not is_reviewer() then raise exception 'Reviewer access required' using errcode='42501';end if;
 if p_dataset<>all(array['meetings','cp_meetings','bookings','leads','all']) then raise exception 'Unknown dataset';end if;
 if cardinality(p_groups)>2 or not(p_groups<@array['associate','team','project','source','cp','firm','rating','week','month','cold_reason','mode','status','branch','cancel_reason']) then raise exception 'Choose up to two valid dimensions';end if;
 if not(p_measures<@array['count','unique_leads','hot_pct','conversion_pct','booking_units','value','average_ticket','cancellation_pct','average_days_to_close']) then raise exception 'Unknown measure';end if;
 select coalesce(array_agg(e),array[]::public.analysis_events[]) into facts from analysis_rows('all',p_filters-'dimensions'-'q',least(a,pa),greatest(b,pb)) e;
 select coalesce(array_agg(e),array[]::public.analysis_events[]) into selected from analysis_rows(p_dataset,p_filters,least(a,pa),greatest(b,pb)) e;
 if cardinality(p_groups)=0 then
  with rows as(select * from unnest(selected) where happened_on between a and b),page as(select * from rows order by happened_on desc nulls last,id limit least(greatest(p_limit,1),500) offset greatest(p_offset,0))
  select jsonb_build_object('total',(select count(*) from rows),'rows',coalesce((select jsonb_agg(to_jsonb(page)-'search_document'||jsonb_build_object('snippet',case when nullif(p_filters->>'q','') is not null then ts_headline('simple',coalesce(remark,''),websearch_to_tsquery('simple',p_filters->>'q'),'StartSel=⟪,StopSel=⟫,MaxFragments=2,MaxWords=25,MinWords=5') else left(remark,200) end)) from page),'[]'),
   'totals',analysis_group_summary(selected,facts,p_dataset,a,b),'previous',analysis_group_summary(selected,facts,p_dataset,pa,pb),'context',c) into item;return item;
 end if;
 for g in select analysis_dimension(e,p_groups[1]) k1,analysis_dimension(e,p_groups[2]) k2,max(analysis_dimension(e,p_groups[1],true)) l1,max(analysis_dimension(e,p_groups[2],true)) l2
 from unnest(selected) e where happened_on between a and b or(p_filters->>'compare'='true' and happened_on between pa and pb) group by 1,2 loop
  select coalesce(array_agg(e),array[]::public.analysis_events[]) into subset from unnest(selected) e where analysis_dimension(e,p_groups[1])=g.k1 and analysis_dimension(e,p_groups[2])=g.k2;
  m:=analysis_group_summary(subset,facts,p_dataset,a,b);prev:=analysis_group_summary(subset,facts,p_dataset,pa,pb);
  select coalesce(jsonb_object_agg(key,value),'{}') into item from jsonb_each(m) where key=any(p_measures);
  result:=result||jsonb_build_array(jsonb_build_object('key1',g.k1,'key2',g.k2,'group1',g.l1,'group2',case when cardinality(p_groups)=2 then g.l2 end,'metrics',item,'previous',prev,'delta',(select jsonb_object_agg(key,case when value='null'::jsonb or prev->key='null'::jsonb then 'null'::jsonb else to_jsonb((value#>>'{}')::numeric-coalesce((prev->>key)::numeric,0)) end) from jsonb_each(item))));
 end loop;
 total:=jsonb_array_length(result);sort_key:=case when p_sort=any(p_measures) then p_sort else p_measures[1] end;
 select coalesce(jsonb_agg(value),'[]') into result from(select value from jsonb_array_elements(result) order by case when p_groups[1] in('week','month') then value->>'key1' end asc,case when p_groups[1] not in('week','month') then(value->'metrics'->>sort_key)::numeric end desc nulls last,value->>'group1' limit least(greatest(p_limit,1),500) offset greatest(p_offset,0)) sorted;
 result:=analysis_color_rows(result,p_measures,'metrics');
 return jsonb_build_object('total',total,'groups',result,'totals',analysis_group_summary(selected,facts,p_dataset,a,b),'previous',analysis_group_summary(selected,facts,p_dataset,pa,pb),'context',c);
end $$;

-- Bulk aggregate authorized facts once. No per-associate re-scan of the RLS views.
create function public.analysis_summary(p_rows public.analysis_events[],p_from date,p_to date) returns jsonb
language sql stable security invoker set search_path=public as $$
 with e as materialized(select * from unnest(p_rows) where happened_on between p_from and p_to),
 m as materialized(select * from e where dataset='meetings' and interaction_type='meeting'),
 last_m as(select distinct on(associate_id,lead_id) * from m order by associate_id,lead_id,happened_on desc,created_at desc,id desc),
 cp as(select distinct on(cp_id) * from e where dataset='cp_meetings' order by cp_id,happened_on desc,created_at desc,id desc),
 hot as(select l.lead_id,(select min(happened_on) from m where lead_id=l.lead_id and rating='hot') first_hot from last_m l where rating='hot'),
 commitments as(select h.lead_id,bool_or(b.status in('token','booking_done','agreement_signed')) committed,bool_or(b.status in('booking_done','agreement_signed')) booked,bool_or(b.status='agreement_signed') agreement from hot h left join e b on b.dataset='bookings' and b.lead_id=h.lead_id and b.happened_on>=h.first_hot group by h.lead_id),
 counts as(select (select count(*) from m) meetings,(select count(*) from last_m) met,(select count(*) from last_m where rating='hot') hot,(select count(*) from last_m where rating='warm') warm,(select count(*) from last_m where rating='cold') cold,
 (select count(*) from e where dataset='cp_meetings') cp_meetings,(select count(*) from cp) cps,(select count(*) from cp where rating='active') active,
 count(*) filter(where dataset='bookings') all_bookings,count(*) filter(where dataset='bookings' and status in('booking_done','agreement_signed')) bookings,coalesce(sum(value) filter(where dataset='bookings' and status in('booking_done','agreement_signed')),0) value,
 count(*) filter(where dataset='bookings' and status='token') tokens,count(*) filter(where dataset='bookings' and status='cancelled') cancellations,count(*) filter(where dataset='bookings' and status='agreement_signed') agreements from e),
 stages as(select 1 n,'leads_met' metric,'Leads met' label,met value from counts union all select 2,'hot_leads','Hot',hot from counts union all select 3,'hot_token','Token or beyond',count(*) filter(where committed) from commitments union all select 4,'hot_booked','Booked',count(*) filter(where booked) from commitments union all select 5,'hot_agreement','Agreement',count(*) filter(where agreement) from commitments),
 steps as(select *,lag(value) over(order by n) prior from stages)
 select jsonb_build_object('customer_meetings',meetings,'leads_met',met,'hot_leads',hot,'warm_leads',warm,'cold_leads',cold,'hot_pct',coalesce(round(100.0*hot/nullif(met,0),2),0),
 'cp_meetings',cp_meetings,'cps_met',cps,'active_cps',active,'bookings',bookings,'booking_value',value,'tokens',tokens,'cancellations',cancellations,'cancellation_pct',coalesce(round(100.0*cancellations/nullif(all_bookings,0),2),0),'agreements',agreements,
 'hot_conversion',coalesce((select round(100.0*count(*) filter(where booked)/nullif(count(*),0),2) from commitments),0),
 'dated_actions_pct',coalesce((select round(100.0*count(*) filter(where next_action_date is not null)/nullif(count(*),0),2) from m where next_action is not null),0),
 'on_time_pct',coalesce((select round(100.0*count(*) filter(where exists(select 1 from interactions next_i where next_i.lead_id=i.lead_id and next_i.associate_id=i.associate_id and next_i.deleted_at is null and(next_i.occurred_on,next_i.created_at,next_i.id)>(i.happened_on,i.created_at,i.id) and next_i.occurred_on<=i.next_action_date))/nullif(count(*),0),2) from m i where i.next_action_date is not null and i.next_action_date<=p_to),0),
 'funnel',jsonb_build_object('stages',(select jsonb_agg(jsonb_build_object('metric',metric,'label',label,'value',value,'conversion_pct',case when prior>0 then round(100.0*value/prior,2) end,'dropoff',case when prior is not null then prior-value end) order by n) from steps))) from counts
$$;
create function public.analysis_booking_breakdown(p_rows public.analysis_events[],p_from date,p_to date,p_previous_from date,p_previous_to date,p_dim text) returns jsonb
language sql stable security invoker set search_path=public as $$
 with e as(select * from unnest(p_rows) where dataset='bookings'),g as(select analysis_dimension(e,p_dim) key,max(analysis_dimension(e,p_dim,true)) label,
 count(*) filter(where happened_on between p_from and p_to and status in('booking_done','agreement_signed')) units,coalesce(sum(value) filter(where happened_on between p_from and p_to and status in('booking_done','agreement_signed')),0) value,
 coalesce(round(100.0*count(*) filter(where happened_on between p_from and p_to and status='cancelled')/nullif(count(*) filter(where happened_on between p_from and p_to),0),2),0) cancellation_pct,
 count(*) filter(where happened_on between p_previous_from and p_previous_to and status in('booking_done','agreement_signed')) previous_units,coalesce(sum(value) filter(where happened_on between p_previous_from and p_previous_to and status in('booking_done','agreement_signed')),0) previous_value from e group by 1)
 select coalesce(jsonb_agg(jsonb_build_object('key1',key,'group1',label,'metrics',jsonb_build_object('booking_units',units,'value',value,'cancellation_pct',cancellation_pct),'previous',jsonb_build_object('booking_units',previous_units,'value',previous_value),'delta',jsonb_build_object('booking_units',units-previous_units,'value',value-previous_value)) order by value desc),'[]') from g
$$;
create function public.analysis_dashboard(p_filters jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare c jsonb:=analysis_context(p_filters);a date:=(c->>'from')::date;b date:=(c->>'to')::date;pa date:=(c->>'previous_from')::date;pb date:=(c->>'previous_to')::date;
 facts public.analysis_events[];own_facts public.analysis_events[];current_summary jsonb;previous_summary jsonb;mo jsonb;oldmo jsonb;metrics jsonb:='{}';pipeline jsonb;league jsonb:='[]';person record;goal numeric;points jsonb;key text;v numeric;pv numeric;unit text;
begin
 if not is_reviewer() then raise exception 'Reviewer access required' using errcode='42501';end if;
 select coalesce(array_agg(e),array[]::public.analysis_events[]) into facts from analysis_rows('all',p_filters,least(a,pa),greatest(b,pb)) e;
 current_summary:=analysis_summary(facts,a,b);previous_summary:=analysis_summary(facts,pa,pb);pipeline:=analysis_pipeline(p_filters,b);
 foreach key in array array['customer_meetings','hot_leads','warm_leads','cold_leads','hot_pct','cp_meetings','active_cps','bookings','booking_value','tokens','cancellations','cancellation_pct','hot_conversion'] loop
  v:=(current_summary->>key)::numeric;pv:=(previous_summary->>key)::numeric;unit:=case when key in('hot_pct','cancellation_pct','hot_conversion') then 'percent' when key='booking_value' then 'rupees' else 'count' end;
  metrics:=metrics||jsonb_build_object(key,jsonb_build_object('value',v,'previous',pv,'delta',v-pv,'delta_pct',case when pv<>0 then round(100.0*(v-pv)/abs(pv),2) end,'unit',unit));
 end loop;
 for person in select * from profiles p where p.active and p.deleted_at is null and p.role in('associate','team_lead') and p.id in(select visible_associates())
  and(nullif(p_filters->>'branch','') is null or p.branch_id=(p_filters->>'branch')::uuid) and(coalesce(jsonb_array_length(p_filters->'associates'),0)=0 or p.id::text in(select jsonb_array_elements_text(p_filters->'associates'))) order by p.full_name loop
  select coalesce(array_agg(e),array[]::public.analysis_events[]) into own_facts from unnest(facts) e where associate_id=person.id;
  mo:=analysis_summary(own_facts,a,b);oldmo:=analysis_summary(own_facts,pa,pb);
  select ceil(sum(t.bookings::numeric*(least(b,(t.month+interval '1 month - 1 day')::date)-greatest(a,t.month)+1)/extract(day from t.month+interval '1 month - 1 day'))) into goal from targets t where t.associate_id=person.id and t.deleted_at is null and t.month<=b and(t.month+interval '1 month - 1 day')::date>=a;
  with bins as(select least(11,greatest(0,(happened_on-a)*12/greatest(b-a+1,1))) bucket,count(*) n from unnest(own_facts) where dataset='meetings' and interaction_type='meeting' and happened_on between a and b group by 1)
  select jsonb_agg(jsonb_build_object('bucket',s,'meetings',coalesce(n,0)) order by s) into points from generate_series(0,11) s left join bins on bucket=s;
  league:=league||jsonb_build_array(jsonb_build_object('id',person.id,'name',person.full_name,'meetings',mo->'customer_meetings','hot',mo->'hot_leads','cp_meetings',mo->'cp_meetings','cps_met',mo->'cps_met','bookings',mo->'bookings','value',mo->'booking_value','target',goal,'achievement_pct',case when goal>0 then round(100.0*(mo->>'bookings')::numeric/goal,2) end,'dated_actions_pct',mo->'dated_actions_pct','on_time_pct',mo->'on_time_pct',
   'hot_stale7',(select count(*) from jsonb_array_elements(pipeline) l where l->>'owner_id'=person.id::text and l->>'rating'='hot' and(l->>'age_days')::int>=7),
   'previous',jsonb_build_object('meetings',oldmo->'customer_meetings','hot',oldmo->'hot_leads','cp_meetings',oldmo->'cp_meetings','cps_met',oldmo->'cps_met','bookings',oldmo->'bookings','value',oldmo->'booking_value','dated_actions_pct',oldmo->'dated_actions_pct','on_time_pct',oldmo->'on_time_pct'),'sparkline',points));
 end loop;
 select coalesce(jsonb_agg(e||jsonb_build_object('delta',(select jsonb_object_agg(k,(e->>k)::numeric-coalesce((e->'previous'->>k)::numeric,0)) from unnest(array['meetings','hot','cp_meetings','cps_met','bookings','value','dated_actions_pct','on_time_pct']) k))),'[]') into league from jsonb_array_elements(league) e;
 league:=analysis_color_rows(league,array['meetings','hot','cp_meetings','cps_met','bookings','value','hot_stale7','dated_actions_pct','on_time_pct']);
 current_summary:=jsonb_set(current_summary,'{funnel,stages}',(select jsonb_agg(s.value||jsonb_build_object('delta',(s.value->>'value')::numeric-coalesce((previous_summary->'funnel'->'stages'->(s.ordinality::int-1)->>'value')::numeric,0)) order by s.ordinality) from jsonb_array_elements(current_summary->'funnel'->'stages') with ordinality s));
 return jsonb_build_object('context',c,'metrics',metrics,'funnel',current_summary->'funnel','previous_funnel',previous_summary->'funnel','league',league,'pipeline',pipeline,
 'by_source',analysis_booking_breakdown(facts,a,b,pa,pb,'source'),'by_project',analysis_booking_breakdown(facts,a,b,pa,pb,'project'),'by_associate',analysis_booking_breakdown(facts,a,b,pa,pb,'associate'),
 'cancellation_reasons',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select coalesce(nullif(trim(cancel_reason),''),'Reason not recorded') reason,count(*) units,coalesce(sum(value),0) value from unnest(facts) where dataset='bookings' and happened_on between a and b and status='cancelled' group by 1 order by count(*) desc) x));
end $$;

create function public.analysis_transitions(p_filters jsonb,p_to date)
returns table(id uuid,record_id uuid,dataset text,lead_id uuid,lead_name text,associate_id uuid,associate_name text,happened_on date,stage text,previous text,next_day date,stamp timestamptz)
language sql stable security invoker set search_path=public as $$
 with events as(
 select i.id,i.id record_id,i.dataset,i.lead_id,i.lead_name,i.associate_id,i.associate_name,i.happened_on,i.rating stage,i.created_at stamp from analysis_rows('all',p_filters-'dimensions'-'q',null,p_to) i where i.dataset='meetings' and i.rating is not null
 union all select h.id,b.id,b.dataset,b.lead_id,b.lead_name,b.associate_id,b.associate_name,
 case when h.status_before is null then b.happened_on else (h.changed_at at time zone 'Asia/Kolkata')::date end,
 case h.status_after when 'booking_done' then 'booked' when 'agreement_signed' then 'agreement' else h.status_after::text end,h.changed_at from analysis_rows('bookings',p_filters-'dimensions'-'q',null,p_to) b join booking_status_history h on h.booking_id=b.id and h.deleted_at is null),
 sequenced as(select *,lag(stage) over(partition by lead_id order by happened_on,stamp,id) previous from events where happened_on<=p_to),
 changes as(select * from sequenced where stage is distinct from previous)
 select id,record_id,dataset,lead_id,lead_name,associate_id,associate_name,happened_on,stage,previous,
 lead(happened_on) over(partition by lead_id order by happened_on,stamp,id),stamp from changes
$$;
create function public.analysis_movement(p_filters jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare c jsonb:=analysis_context(p_filters);a date:=(c->>'from')::date;b date:=(c->>'to')::date;pa date:=(c->>'previous_from')::date;pb date:=(c->>'previous_to')::date;result jsonb;
begin
 if not is_reviewer() then raise exception 'Reviewer access required' using errcode='42501';end if;
 with changes as materialized(select * from analysis_transitions(p_filters,b)),matrix as(select coalesce(previous,'new') from_stage,stage to_stage,count(*) filter(where happened_on between a and b) count,count(*) filter(where happened_on between pa and pb) previous_count from changes group by 1,2),
 last_change as(select distinct on(lead_id) * from changes where happened_on<=least(b,(now() at time zone 'Asia/Kolkata')::date) order by lead_id,happened_on desc,stamp desc,id desc)
 select jsonb_build_object('context',c,'matrix',(select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('delta',count-previous_count)),'[]') from matrix x),
 'durations',(select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('delta',average_days-previous_average_days)),'[]') from(select stage,round(avg(next_day-happened_on) filter(where next_day between a and b),2) average_days,round(avg(next_day-happened_on) filter(where next_day between pa and pb),2) previous_average_days,count(*) filter(where next_day between a and b) completed_intervals from changes where next_day is not null group by stage) x),
 'stale',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select lead_id,lead_name,associate_id,associate_name,stage,least(b,(now() at time zone 'Asia/Kolkata')::date)-happened_on days_stale from last_change where least(b,(now() at time zone 'Asia/Kolkata')::date)-happened_on>=21 order by days_stale desc limit 200) x),
 'backwards',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select lead_id,lead_name,associate_id,associate_name,previous from_stage,stage to_stage,happened_on event_day from changes where happened_on between a and b and ((previous='hot' and stage in('warm','cold')) or(previous='warm' and stage='cold') or stage='cancelled') order by happened_on desc limit 200) x)) into result;
 return result;
end $$;

create function public.analysis_cps(p_filters jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare c jsonb:=analysis_context(p_filters);a date:=(c->>'from')::date;b date:=(c->>'to')::date;pa date:=(c->>'previous_from')::date;pb date:=(c->>'previous_to')::date;result jsonb;
begin
 if not is_reviewer() then raise exception 'Reviewer access required' using errcode='42501';end if;
 with cp as materialized(select * from analysis_rows('cp_meetings',p_filters,a,b)),l as materialized(select * from analysis_rows('leads',p_filters,a,b) where source='cp'),
 books as materialized(select * from analysis_rows('bookings',p_filters,a,b) where source='cp'),oldcp as materialized(select * from analysis_rows('cp_meetings',p_filters,pa,pb)),oldl as materialized(select * from analysis_rows('leads',p_filters,pa,pb) where source='cp'),oldb as materialized(select * from analysis_rows('bookings',p_filters,pa,pb) where source='cp'),
 lifetime as materialized(select * from analysis_rows('bookings',p_filters,null,null) where source='cp' and(status in('booking_done','agreement_signed')) and(happened_on<=b or happened_on is null)),
 contact_history as materialized(select * from analysis_rows('cp_meetings',p_filters,null,b)),lead30 as materialized(select * from analysis_rows('leads',p_filters,b-29,b) where source='cp'),
 firms as(select coalesce(firm_id::text,firm_name) key,max(firm_name) name from(select firm_id,firm_name from cp union all select firm_id,firm_name from l union all select firm_id,firm_name from books) s group by 1),
 stats as(select f.*,
 (select count(*) from cp where coalesce(firm_id::text,firm_name)=f.key) meetings,
 (select count(*) from l where coalesce(firm_id::text,firm_name)=f.key) leads,
 (select count(*) from l where coalesce(firm_id::text,firm_name)=f.key and rating='hot') hot,
 (select count(*) from books where coalesce(firm_id::text,firm_name)=f.key and status in('booking_done','agreement_signed')) bookings,
 (select coalesce(sum(value),0) from books where coalesce(firm_id::text,firm_name)=f.key and status in('booking_done','agreement_signed')) value,
 coalesce((select round(100.0*count(*) filter(where status='cancelled')/nullif(count(*),0),2) from books where coalesce(firm_id::text,firm_name)=f.key),0) cancellation_pct,
 (select least(b,(now() at time zone 'Asia/Kolkata')::date)-max(happened_on) from contact_history where coalesce(firm_id::text,firm_name)=f.key and happened_on<=least(b,(now() at time zone 'Asia/Kolkata')::date)) days_since_contact,
 (select count(*) from lifetime where coalesce(firm_id::text,firm_name)=f.key) lifetime_bookings,
 jsonb_build_object('hot',(select count(*) from oldl where coalesce(firm_id::text,firm_name)=f.key and rating='hot'),'cancellation_pct',coalesce((select round(100.0*count(*) filter(where status='cancelled')/nullif(count(*),0),2) from oldb where coalesce(firm_id::text,firm_name)=f.key),0),'days_since_contact',(select pb-max(happened_on) from contact_history where coalesce(firm_id::text,firm_name)=f.key and happened_on<=pb),'lifetime_bookings',(select count(*) from lifetime where coalesce(firm_id::text,firm_name)=f.key and(happened_on<=pb or happened_on is null)),'meetings',(select count(*) from oldcp where coalesce(firm_id::text,firm_name)=f.key),'leads',(select count(*) from oldl where coalesce(firm_id::text,firm_name)=f.key),'bookings',(select count(*) from oldb where coalesce(firm_id::text,firm_name)=f.key and status in('booking_done','agreement_signed')),'value',(select coalesce(sum(value),0) from oldb where coalesce(firm_id::text,firm_name)=f.key and status in('booking_done','agreement_signed'))) previous from firms f),
 latest as materialized(select distinct on(cp_id) * from analysis_rows('cp_meetings',p_filters,null,b) order by cp_id,happened_on desc,created_at desc,id desc),
 flags as(select cp_id,cp_name,firm_name,rating,
 (select count(*) from lead30 x where x.cp_id=c.cp_id) leads_30,
 (select count(*) from books x where x.cp_id=c.cp_id and status in('booking_done','agreement_signed')) bookings from latest c)
 select jsonb_build_object('context',c,'firms',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('never_converted',leads>0 and lifetime_bookings=0,'delta',analysis_json_delta(to_jsonb(s),s.previous,array['meetings','leads','hot','bookings','value','cancellation_pct','days_since_contact','lifetime_bookings'])) order by value desc,leads desc),'[]') from stats s),
 'contacts',(select coalesce(jsonb_agg(jsonb_build_object('id',cp_id,'name',cp_name,'firm',firm_name,'rating',rating) order by cp_name),'[]') from latest),
 'flags',(select coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object('reason',case when rating in('hot','active') and leads_30=0 then 'Hot/Active with no individually linked leads in 30 days' else 'Cold but sourced a confirmed booking' end)),'[]') from flags f where(rating in('hot','active') and leads_30=0)or(rating='cold' and bookings>0))) into result;
 return result;
end $$;

create function public.analysis_plots(p_filters jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare c jsonb:=analysis_context(p_filters);a date:=(c->>'from')::date;b date:=(c->>'to')::date;result jsonb;prior jsonb;
begin
 if not is_reviewer() then raise exception 'Reviewer access required' using errcode='42501';end if;
 with hot as(select e.project_id,e.project_name,e.lead_id,e.lead_name,e.associate_name,p.plot,'hot'::text status,e.happened_on event_day,e.id,'meetings'::text dataset,e.created_at stamp,false is_change from analysis_rows('all',p_filters,a,b) e cross join lateral unnest(e.plot_names) p(plot) where e.dataset='meetings' and e.rating='hot'),
 visible_books as materialized(select * from analysis_rows('bookings',p_filters,null,null) where happened_on<=b or happened_on is null),
 books as materialized(select e.project_id,e.project_name,e.lead_id,e.lead_name,e.associate_name,p.plot,h.status_after::text status,
 case when h.status_before is null then e.happened_on else (h.changed_at at time zone 'Asia/Kolkata')::date end event_day,e.id,'bookings'::text dataset,h.changed_at stamp,h.status_before is not null is_change
 from visible_books e join booking_status_history h on h.booking_id=e.id and h.deleted_at is null cross join lateral unnest(e.plot_names) p(plot)),
 events as materialized(select h.*,lower(trim(plot)) plot_key from hot h union all select be.*,lower(trim(plot)) plot_key from books be where event_day<=b or event_day is null),
 current_hot as materialized(select p as p,l.project_id,plot from jsonb_array_elements(analysis_pipeline(p_filters,b)) p join leads l on l.id=(p->>'id')::uuid cross join lateral jsonb_array_elements_text(p->'plots') plot where p->>'rating'='hot'),
 grouped as(select project_id,plot_key,max(project_name) project,max(plot) plot,jsonb_agg(to_jsonb(e) order by event_day desc nulls last,stamp desc) history,
 (select count(distinct(ch.p->>'id')) from current_hot ch where ch.project_id=e.project_id and lower(trim(ch.plot))=e.plot_key) hot_customers,
 (select count(distinct x.lead_id) from visible_books x cross join lateral unnest(x.plot_names) plot where x.project_id=e.project_id and lower(trim(plot))=e.plot_key and x.status in('token','booking_done','agreement_signed')) live_customers,
 exists(select 1 from books cancelled join books later on later.project_id=cancelled.project_id and lower(trim(later.plot))=lower(trim(cancelled.plot)) and(later.event_day>cancelled.event_day or(later.id=cancelled.id and later.is_change and later.stamp>cancelled.stamp)) where cancelled.project_id=e.project_id and lower(trim(cancelled.plot))=e.plot_key and cancelled.status='cancelled' and later.status in('token','booking_done','agreement_signed')) rebooked_after_cancel
 from events e group by project_id,plot_key)
 select jsonb_build_object('context',c,'plots',coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('double_hot',hot_customers>1,'double_reserved',live_customers>1) order by hot_customers desc,live_customers desc,project,plot),'[]')) into result from grouped g;
 if p_filters->>'compare'='true' then
  prior:=analysis_plots(p_filters||jsonb_build_object('window','custom','from',c->>'previous_from','to',c->>'previous_to','compare',false));
  select coalesce(jsonb_agg(p||jsonb_build_object('previous',coalesce(o,'{}'),'delta',analysis_json_delta(p,coalesce(o,'{}'),array['hot_customers','live_customers']))),'[]') into prior
   from jsonb_array_elements(result->'plots') p left join lateral(select x from jsonb_array_elements(prior->'plots') x where x->>'project_id'=p->>'project_id' and x->>'plot_key'=p->>'plot_key' limit 1) old(o) on true;
  result:=jsonb_set(result,'{plots}',prior);
 end if;
 return result;
end $$;

create table public.saved_analysis_views(id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles default auth.uid(),branch_id uuid not null references public.branches,name text not null check(length(trim(name)) between 1 and 100),state jsonb not null,shared boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz);
alter table public.saved_analysis_views enable row level security;
create policy saved_views_read on public.saved_analysis_views for select to authenticated using(is_reviewer() and(owner_id=auth.uid() or(shared and(branch_id=my_branch() or my_role()='super_admin'))));
create policy saved_views_insert on public.saved_analysis_views for insert to authenticated with check(is_reviewer() and owner_id=auth.uid() and branch_id=my_branch());
create policy saved_views_update on public.saved_analysis_views for update to authenticated using(is_reviewer() and owner_id=auth.uid()) with check(owner_id=auth.uid() and branch_id=my_branch());
grant select,insert,update on public.saved_analysis_views to authenticated;grant all on public.saved_analysis_views to service_role;
create trigger saved_views_updated before update on public.saved_analysis_views for each row execute function public.set_updated_at();
create trigger saved_views_audit after insert or update on public.saved_analysis_views for each row execute function public.audit_row();
create index interactions_analysis_idx on public.interactions(branch_id,occurred_on,associate_id) where deleted_at is null;
create index cp_interactions_analysis_idx on public.cp_interactions(branch_id,occurred_on,associate_id) where deleted_at is null;
create index bookings_analysis_idx on public.bookings(branch_id,booking_date,status,associate_id) where deleted_at is null;
create index bookings_firm_analysis_idx on public.bookings(cp_firm_key,booking_date) where deleted_at is null;
create index leads_firm_analysis_idx on public.leads(branch_id,lower(cp_firm_name)) where deleted_at is null;
create index saved_views_owner_idx on public.saved_analysis_views(owner_id) where deleted_at is null;
revoke all on function public.analysis_cycle(date,uuid),public.analysis_context(jsonb),public.analysis_dimension(public.analysis_events,text,boolean),public.analysis_rows(text,jsonb,date,date),public.analysis_pipeline(jsonb,date),public.analysis_metric_rows(text,jsonb,date,date,text),public.analysis_drill(text,jsonb,integer,integer,text),public.analysis_explore(text,jsonb,text[],text[],integer,integer,text),public.analysis_dashboard(jsonb),public.analysis_movement(jsonb),public.analysis_cps(jsonb),public.analysis_plots(jsonb) from public,anon;
grant execute on function public.analysis_cycle(date,uuid),public.analysis_context(jsonb),public.analysis_dimension(public.analysis_events,text,boolean),public.analysis_rows(text,jsonb,date,date),public.analysis_pipeline(jsonb,date),public.analysis_metric_rows(text,jsonb,date,date,text),public.analysis_drill(text,jsonb,integer,integer,text),public.analysis_explore(text,jsonb,text[],text[],integer,integer,text),public.analysis_dashboard(jsonb),public.analysis_movement(jsonb),public.analysis_cps(jsonb),public.analysis_plots(jsonb) to authenticated;

create function public.analysis_options(p_dimensions boolean default false) returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
 if not is_reviewer() then raise exception 'Reviewer access required' using errcode='42501';end if;
 return jsonb_build_object('people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name,'role',role,'reports_to',reports_to) order by full_name),'[]') from profiles where active and deleted_at is null and role in('associate','team_lead')),
 'projects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from projects where active and deleted_at is null),
 'cps',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',concat_ws(' · ',name,firm)) order by name),'[]') from channel_partners where deleted_at is null),
 'firms',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from cp_firms where deleted_at is null),
 'branches',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from branches where deleted_at is null),
 'dimensions',case when p_dimensions then(with facts as materialized(select * from analysis_events) select jsonb_object_agg(dim,choices) from(select dim,jsonb_agg(distinct jsonb_build_object('id',analysis_dimension(e::analysis_events,dim),'name',analysis_dimension(e::analysis_events,dim,true))) choices from facts e cross join unnest(array['associate','team','project','source','cp','firm','rating','week','month','cold_reason','mode','status','branch','cancel_reason']) dim group by dim) d) else '{}'::jsonb end,
 'saved',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'shared',shared) order by name),'[]') from saved_analysis_views where deleted_at is null));
end $$;
revoke all on function public.analysis_options(boolean) from public,anon;
grant execute on function public.analysis_options(boolean) to authenticated;

revoke all on function public.analysis_transitions(jsonb,date) from public,anon;
grant execute on function public.analysis_transitions(jsonb,date) to authenticated;

revoke all on function public.analysis_summary(public.analysis_events[],date,date),public.analysis_booking_breakdown(public.analysis_events[],date,date,date,date,text) from public,anon;
grant execute on function public.analysis_summary(public.analysis_events[],date,date),public.analysis_booking_breakdown(public.analysis_events[],date,date,date,date,text) to authenticated;

revoke all on function public.analysis_group_summary(public.analysis_events[],public.analysis_events[],text,date,date) from public,anon;
grant execute on function public.analysis_group_summary(public.analysis_events[],public.analysis_events[],text,date,date) to authenticated;

create function public.analysis_json_delta(p_current jsonb,p_previous jsonb,p_keys text[]) returns jsonb language sql immutable as $$
 select coalesce(jsonb_object_agg(k,case when p_current->>k is null or p_previous->>k is null then null else (p_current->>k)::numeric-(p_previous->>k)::numeric end),'{}') from unnest(p_keys) k
$$;
create function public.analysis_color_rows(p_rows jsonb,p_keys text[],p_field text default '') returns jsonb language sql immutable as $$
 select coalesce(jsonb_agg(e.value||jsonb_build_object('heat',(select jsonb_object_agg(k,coalesce(abs((case when p_field='' then e.value else e.value->p_field end->>k)::numeric)/nullif((select max(abs((case when p_field='' then v else v->p_field end->>k)::numeric)) from jsonb_array_elements(p_rows) v),0),0)) from unnest(p_keys) k)) order by e.ordinality),'[]') from jsonb_array_elements(p_rows) with ordinality e
$$;
revoke all on function public.analysis_json_delta(jsonb,jsonb,text[]),public.analysis_color_rows(jsonb,text[],text) from public,anon;
grant execute on function public.analysis_json_delta(jsonb,jsonb,text[]),public.analysis_color_rows(jsonb,text[],text) to authenticated;

-- The same cohort member rules support Explorer measures and exact row drawers.
create function public.analysis_group_members(p_group public.analysis_events[],p_facts public.analysis_events[],p_dataset text,p_from date,p_to date,p_measure text,p_basis text default 'numerator')
returns setof public.analysis_events language sql stable security invoker set search_path=public as $$
 with e as materialized(select * from unnest(p_group) where happened_on between p_from and p_to),facts as materialized(select * from unnest(p_facts) where happened_on between p_from and p_to),
 cohort as(select distinct lead_id from e where lead_id is not null union select l.lead_id from facts l where l.dataset='leads' and p_dataset='cp_meetings' and l.source='cp' and exists(select 1 from e where e.cp_id=l.cp_id or(e.firm_id is not null and e.firm_id=l.firm_id))),
 representatives as(select distinct on(lead_id) * from facts where lead_id in(select lead_id from cohort) order by lead_id,case dataset when 'leads' then 0 else 1 end,happened_on desc,created_at desc,id desc),
 last_m as(select distinct on(i.associate_id,i.lead_id) i.* from facts i where i.dataset='meetings' and i.interaction_type='meeting' and i.lead_id in(select lead_id from cohort) and(p_dataset<>'meetings' or i.id in(select id from e)) order by i.associate_id,i.lead_id,i.happened_on desc,i.created_at desc,i.id desc),
 books as materialized(select x.* from facts x where x.dataset='bookings' and((p_dataset in('bookings','all') and x.id in(select id from e where dataset='bookings')) or(p_dataset not in('bookings','all') and(x.lead_id in(select lead_id from cohort) or(p_dataset='cp_meetings' and exists(select 1 from e where e.cp_id=x.cp_id or(e.firm_id is not null and e.firm_id=x.firm_id)))))))
 select * from e where p_measure='count'
 union all select * from representatives where p_measure='unique_leads' or(p_measure='conversion_pct' and(p_basis='denominator' or exists(select 1 from books b where b.lead_id=representatives.lead_id and b.status in('booking_done','agreement_signed'))))
 union all select * from last_m where p_measure='hot_pct' and(p_basis='denominator' or rating='hot')
 union all select b.* from books b where (p_measure in('booking_units','value','average_ticket','average_days_to_close') and b.status in('booking_done','agreement_signed') and(p_measure<>'average_days_to_close' or exists(select 1 from leads l where l.id=b.lead_id and b.happened_on>=coalesce(l.created_on,(l.created_at at time zone 'Asia/Kolkata')::date)))) or(p_measure='cancellation_pct' and(p_basis='denominator' or b.status='cancelled'))
$$;
revoke all on function public.analysis_group_members(public.analysis_events[],public.analysis_events[],text,date,date,text,text) from public,anon;
grant execute on function public.analysis_group_members(public.analysis_events[],public.analysis_events[],text,date,date,text,text) to authenticated;
