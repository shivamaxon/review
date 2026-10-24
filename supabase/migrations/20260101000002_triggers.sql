-- Branch Review OS - migration 2: triggers.
-- All trigger functions are SECURITY DEFINER so they can maintain derived state
-- (e.g. a lead's current rating) regardless of who triggered them. They never
-- expose data: they only write rows the caller already had the right to create.

-- ================================================================ updated_at everywhere
do $$
declare t text;
begin
  foreach t in array array[
    'branches','profiles','projects','cold_reasons','next_action_types','review_cycle',
    'channel_partners','leads','interactions','cp_interactions','bookings',
    'booking_status_history','targets','review_sessions','review_actions']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
end $$;

-- ================================================================ profiles guard
-- Signed-in users (auth.uid() not null) can only change their own harmless fields.
-- Role / branch / reporting line / active flag are changed server-side with the service key.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if new.role        is distinct from old.role
    or new.branch_id   is distinct from old.branch_id
    or new.reports_to  is distinct from old.reports_to
    or new.active      is distinct from old.active
    or new.designation is distinct from old.designation
    or new.email       is distinct from old.email
    or new.deleted_at  is distinct from old.deleted_at then
      raise exception 'You cannot change role, branch, reporting line, status or designation from the app. Ask an admin.'
        using errcode = '42501';
    end if;
    if new.must_change_password and not old.must_change_password then
      raise exception 'must_change_password can only be switched on by an admin' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ================================================================ channel partner dedupe key
create or replace function public.cp_set_key() returns trigger
language plpgsql as $$
declare digits text;
begin
  if new.branch_id is null then
    select branch_id into new.branch_id from public.profiles where id = auth.uid();
  end if;
  digits := right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 10);
  if length(digits) = 10 then
    new.normalized_key := 'p:' || digits;
  else
    new.normalized_key := 'n:' || lower(regexp_replace(coalesce(new.name, ''), '[^[:alnum:]]', '', 'g'))
                          || '|' || lower(regexp_replace(coalesce(new.firm, ''), '[^[:alnum:]]', '', 'g'));
  end if;
  return new;
end $$;
create trigger channel_partners_key before insert or update of name, firm, phone, branch_id on public.channel_partners
  for each row execute function public.cp_set_key();

-- ================================================================ leads: branch from owner
create or replace function public.leads_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is null then
    select branch_id into new.branch_id from public.profiles where id = new.owner_id;
  end if;
  return new;
end $$;
create trigger leads_before_insert before insert on public.leads
  for each row execute function public.leads_before_insert();

-- ================================================================ lead state from interactions
-- The lead row is a cache of its newest (by occurred_on, then insertion time) live interaction.
-- Back-dated entries therefore never overwrite newer state, and soft-deleting an
-- interaction rolls the lead back to the previous one.
create or replace function public.refresh_lead_from_interactions(p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x public.interactions%rowtype;
begin
  select * into x from public.interactions
   where lead_id = p_lead and deleted_at is null
   order by occurred_on desc, created_at desc
   limit 1;
  if not found then return; end if;

  update public.leads l set
    current_rating   = x.rating_after,
    last_touch_at    = (x.occurred_on::timestamp at time zone 'Asia/Kolkata'),
    next_action      = x.next_action,
    next_action_date = x.next_action_date,
    cold_reason      = case when x.rating_after = 'cold' then x.cold_reason else null end,
    plot_names       = case when cardinality(x.plot_names) > 0 then x.plot_names else l.plot_names end
  where l.id = p_lead;
end $$;

create or replace function public.interactions_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype;
begin
  select * into l from public.leads where id = new.lead_id and deleted_at is null;
  if not found then
    raise exception 'Lead % does not exist', new.lead_id using errcode = '23503';
  end if;
  new.branch_id    := l.branch_id;
  new.associate_id := coalesce(new.associate_id, auth.uid(), l.owner_id);

  -- rating_before = rating_after of the chronologically previous interaction (NULL = first contact)
  if new.rating_before is null then
    select i.rating_after into new.rating_before
      from public.interactions i
     where i.lead_id = new.lead_id and i.deleted_at is null
       and (i.occurred_on, i.created_at) < (new.occurred_on, new.created_at)
     order by i.occurred_on desc, i.created_at desc
     limit 1;
  end if;
  return new;
end $$;
create trigger interactions_before_insert before insert on public.interactions
  for each row execute function public.interactions_before_insert();

create or replace function public.interactions_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_lead_from_interactions(new.lead_id);
  return null;
end $$;
create trigger interactions_after_insert after insert on public.interactions
  for each row execute function public.interactions_after_change();
create trigger interactions_after_softdelete after update of deleted_at on public.interactions
  for each row when (old.deleted_at is distinct from new.deleted_at)
  execute function public.interactions_after_change();

-- ================================================================ CP state from cp_interactions
create or replace function public.refresh_cp_from_interactions(p_cp uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x public.cp_interactions%rowtype;
begin
  select * into x from public.cp_interactions
   where cp_id = p_cp and deleted_at is null
   order by occurred_on desc, created_at desc
   limit 1;
  if not found then return; end if;

  update public.channel_partners c set
    current_rating   = x.rating_after,
    last_touch_at    = (x.occurred_on::timestamp at time zone 'Asia/Kolkata'),
    next_action      = x.next_action,
    next_action_date = x.next_action_date
  where c.id = p_cp;
end $$;

create or replace function public.cp_interactions_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.channel_partners%rowtype;
begin
  select * into c from public.channel_partners where id = new.cp_id and deleted_at is null;
  if not found then
    raise exception 'Channel partner % does not exist', new.cp_id using errcode = '23503';
  end if;
  new.branch_id    := c.branch_id;
  new.associate_id := coalesce(new.associate_id, auth.uid());

  if new.rating_before is null then
    select i.rating_after into new.rating_before
      from public.cp_interactions i
     where i.cp_id = new.cp_id and i.deleted_at is null
       and (i.occurred_on, i.created_at) < (new.occurred_on, new.created_at)
     order by i.occurred_on desc, i.created_at desc
     limit 1;
  end if;
  return new;
end $$;
create trigger cp_interactions_before_insert before insert on public.cp_interactions
  for each row execute function public.cp_interactions_before_insert();

create or replace function public.cp_interactions_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_cp_from_interactions(new.cp_id);
  return null;
end $$;
create trigger cp_interactions_after_insert after insert on public.cp_interactions
  for each row execute function public.cp_interactions_after_change();
create trigger cp_interactions_after_softdelete after update of deleted_at on public.cp_interactions
  for each row when (old.deleted_at is distinct from new.deleted_at)
  execute function public.cp_interactions_after_change();

-- ================================================================ bookings
create or replace function public.bookings_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype;
begin
  select * into l from public.leads where id = new.lead_id and deleted_at is null;
  if not found then
    raise exception 'Lead % does not exist', new.lead_id using errcode = '23503';
  end if;
  new.branch_id    := l.branch_id;
  new.associate_id := coalesce(new.associate_id, auth.uid(), l.owner_id);
  new.project_id   := coalesce(new.project_id, l.project_id);
  new.source       := coalesce(new.source, l.source);
  new.cp_id        := coalesce(new.cp_id, l.cp_id);
  return new;
end $$;
create trigger bookings_before_insert before insert on public.bookings
  for each row execute function public.bookings_before_insert();

-- a lead is 'booked' while it has at least one live booking_done / agreement_signed booking
-- (a lead marked 'lost' stays lost until someone reopens it).
create or replace function public.refresh_lead_status(p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.leads l set status = case
      when exists (select 1 from public.bookings b
                    where b.lead_id = p_lead and b.deleted_at is null
                      and b.status in ('booking_done', 'agreement_signed')) then 'booked'
      when l.status = 'booked' then 'open'
      else l.status end
  where l.id = p_lead;
end $$;

create or replace function public.bookings_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.booking_status_history (booking_id, branch_id, associate_id, status_before, status_after, changed_by)
    values (new.id, new.branch_id, new.associate_id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.booking_status_history (booking_id, branch_id, associate_id, status_before, status_after, changed_by)
    values (new.id, new.branch_id, new.associate_id, old.status, new.status, auth.uid());
  end if;
  perform public.refresh_lead_status(new.lead_id);
  return null;
end $$;
create trigger bookings_after_insert after insert on public.bookings
  for each row execute function public.bookings_after_change();
create trigger bookings_after_update after update of status, deleted_at on public.bookings
  for each row execute function public.bookings_after_change();

-- ================================================================ append-only history
create or replace function public.history_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% is append-only: rows cannot be deleted (soft-delete instead)', tg_table_name using errcode = '42501';
  end if;
  -- only the soft-delete bookkeeping columns may change
  -- (generated search columns are not yet computed inside a BEFORE trigger, so they are ignored)
  if (to_jsonb(new) - array['deleted_at', 'updated_at', 'remark_tsv'])
     is distinct from (to_jsonb(old) - array['deleted_at', 'updated_at', 'remark_tsv']) then
    raise exception '% is append-only: add a new entry instead of editing history', tg_table_name using errcode = '42501';
  end if;
  return new;
end $$;
create trigger interactions_history_guard before update or delete on public.interactions
  for each row execute function public.history_guard();
create trigger cp_interactions_history_guard before update or delete on public.cp_interactions
  for each row execute function public.history_guard();
create trigger booking_history_guard before update or delete on public.booking_status_history
  for each row execute function public.history_guard();

create or replace function public.audit_log_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is immutable' using errcode = '42501';
end $$;
create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function public.audit_log_guard();

-- ================================================================ audit trail
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb; branch uuid;
begin
  j := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  branch := coalesce((j ->> 'branch_id')::uuid, case when tg_table_name = 'branches' then (j ->> 'id')::uuid end);
  insert into public.audit_log (actor_id, branch_id, table_name, row_id, action, old_data, new_data)
  values (auth.uid(), branch, tg_table_name, (j ->> 'id')::uuid, tg_op,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'branches','profiles','projects','cold_reasons','next_action_types','review_cycle',
    'channel_partners','leads','bookings','targets','review_sessions','review_actions']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()',
                   t || '_audit', t);
  end loop;
end $$;
-- interactions are history themselves: audit only the (soft) edits
create trigger interactions_audit    after update on public.interactions    for each row execute function public.audit_row();
create trigger cp_interactions_audit after update on public.cp_interactions for each row execute function public.audit_row();
