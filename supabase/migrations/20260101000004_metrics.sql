-- Branch Review OS - migration 4: THE metric dictionary (see docs/metrics.md).
-- Every dashboard number comes from these functions. They run as the caller
-- (security invoker) so Row Level Security decides whose numbers each user can see.

-- ---------------------------------------------------------------- review period resolver
-- Resolves the review window containing p_on from the branch's review_cycle rows.
-- Default cycle: 1-10, 11-20, 21-end of month.
create or replace function public.current_review_period(p_on date default ((now() at time zone 'Asia/Kolkata')::date))
returns table (label text, period_start date, period_end date)
language sql stable security invoker set search_path = public as $$
  with m as (
    select date_trunc('month', p_on)::date as first_day,
           (date_trunc('month', p_on) + interval '1 month - 1 day')::date as last_day
  )
  select rc.label,
         (m.first_day + (rc.start_day - 1))::date,
         least(coalesce(m.first_day + (rc.end_day - 1), m.last_day), m.last_day)::date
    from public.review_cycle rc, m
   where rc.deleted_at is null
     and rc.branch_id = public.my_branch()
     and p_on between (m.first_day + (rc.start_day - 1)) and least(coalesce(m.first_day + (rc.end_day - 1), m.last_day), m.last_day)
   order by rc.sort_order
   limit 1
$$;

-- ---------------------------------------------------------------- per-associate metrics
-- Definitions (identical to docs/metrics.md):
--   customer_meetings = interactions of type 'meeting' with occurred_on in the period
--   leads_met         = distinct leads with >= 1 meeting in the period
--   hot/warm/cold     = leads_met split by the lead's rating after its LAST meeting in the period
--   hot_pct           = hot_leads / leads_met
--   cps_met           = distinct CPs with >= 1 CP interaction in the period
--   cp_*              = cps_met split by the CP's rating after its LAST CP interaction in the period
--   bookings          = bookings with status in (booking_done, agreement_signed), booking_date in the period
--   booking_value     = sum(value) of those same bookings
--   tokens(+value)    = status = token            (reported separately, never in bookings)
--   cancelled(+value) = status = cancelled        (excluded from bookings, always reported)
create or replace function public.associate_metrics(p_from date, p_to date)
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
     where i.deleted_at is null and i.interaction_type = 'meeting' and i.occurred_on between p_from and p_to
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
     where c.deleted_at is null and c.occurred_on between p_from and p_to
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
     where deleted_at is null and booking_date between p_from and p_to
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
create or replace function public.team_metrics(p_from date, p_to date)
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
    from public.associate_metrics(p_from, p_to)
$$;

grant execute on function public.current_review_period(date), public.associate_metrics(date, date),
                          public.team_metrics(date, date) to authenticated, service_role;

revoke execute on function public.current_review_period(date), public.associate_metrics(date, date),
                           public.team_metrics(date, date) from public, anon;
