-- Branch Review OS - migration 3: Row Level Security.
--
-- Visibility rule (one function, used by every policy):
--   associate     -> own rows
--   team_lead     -> self + everyone below them via reports_to (recursive)
--   branch_admin  -> everyone in their branch
--   super_admin   -> everyone in every branch
--
-- Soft-deleted rows are NOT hidden by policies (a policy that hides a row also blocks the
-- UPDATE that soft-deletes it). Queries and metric views filter `deleted_at is null`.

-- ================================================================ helper functions
create or replace function public.my_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active and deleted_at is null
$$;

create or replace function public.my_branch() returns uuid
language sql stable security definer set search_path = public as $$
  select branch_id from public.profiles where id = auth.uid() and active and deleted_at is null
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('branch_admin', 'super_admin'), false)
$$;

create or replace function public.is_reviewer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('team_lead', 'branch_admin', 'super_admin'), false)
$$;

create or replace function public.visible_associates() returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive me as (
    select id, role, branch_id from public.profiles
     where id = auth.uid() and active and deleted_at is null
  ), tree(id) as (
    select id from me
    union                                   -- UNION (not ALL) so a reporting loop cannot recurse forever
    select c.id from public.profiles c join tree t on c.reports_to = t.id
  )
  select p.id from public.profiles p cross join me
   where me.role = 'super_admin'
      or (me.role = 'branch_admin' and p.branch_id = me.branch_id)
      or (me.role = 'team_lead'    and p.id in (select id from tree))
      or p.id = me.id
$$;

-- Used by the keep-alive job: proves the database is awake without needing a login.
create or replace function public.ping() returns timestamptz
language sql stable security definer set search_path = public as $$ select now() $$;

-- ================================================================ privileges
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant select, insert, update on tables to authenticated;
grant usage, select on all sequences in schema public to authenticated, service_role;

grant execute on function public.my_role(), public.my_branch(), public.is_admin(), public.is_reviewer(),
                          public.visible_associates() to authenticated, service_role;
grant execute on function public.ping() to anon, authenticated, service_role;

-- ================================================================ enable RLS
do $$
declare t text;
begin
  foreach t in array array[
    'branches','profiles','projects','cold_reasons','next_action_types','review_cycle',
    'channel_partners','leads','interactions','cp_interactions','bookings',
    'booking_status_history','targets','review_sessions','review_actions','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ================================================================ branches / profiles
create policy branches_select on public.branches for select to authenticated
  using (id = public.my_branch() or public.my_role() = 'super_admin');
create policy branches_write on public.branches for all to authenticated
  using (public.my_role() = 'super_admin') with check (public.my_role() = 'super_admin');

create policy profiles_select on public.profiles for select to authenticated
  using (id in (select public.visible_associates()));
-- Users may edit only their own row (the guard trigger limits which columns).
-- Creating users and changing roles is done server-side with the service key.
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() and public.my_role() is not null)
  with check (id = auth.uid());

-- ================================================================ config (read: everyone signed in; write: admins)
do $$
declare t text;
begin
  foreach t in array array['projects','cold_reasons','next_action_types','review_cycle']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.my_role() is not null)',
                   t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin())',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())',
                   t || '_update', t);
  end loop;
end $$;

-- review cycles belong to one branch: admins may only change their own branch's cycle
drop policy review_cycle_insert on public.review_cycle;
drop policy review_cycle_update on public.review_cycle;
create policy review_cycle_insert on public.review_cycle for insert to authenticated
  with check (public.is_admin() and (branch_id = public.my_branch() or public.my_role() = 'super_admin'));
create policy review_cycle_update on public.review_cycle for update to authenticated
  using (public.is_admin() and (branch_id = public.my_branch() or public.my_role() = 'super_admin'))
  with check (public.is_admin() and (branch_id = public.my_branch() or public.my_role() = 'super_admin'));

-- ================================================================ channel partners
-- The CP directory is shared inside a branch (so two associates meeting the same CP
-- do not create duplicates). CP *meetings* (cp_interactions) stay private to the associate.
create policy cp_select on public.channel_partners for select to authenticated
  using (branch_id = public.my_branch() or public.my_role() = 'super_admin');
create policy cp_insert on public.channel_partners for insert to authenticated
  with check (branch_id = public.my_branch() or public.my_role() = 'super_admin');
create policy cp_update on public.channel_partners for update to authenticated
  using (created_by = auth.uid()
         or (public.is_admin() and (branch_id = public.my_branch() or public.my_role() = 'super_admin')))
  with check (branch_id = public.my_branch() or public.my_role() = 'super_admin');

-- ================================================================ leads
create policy leads_select on public.leads for select to authenticated
  using (owner_id in (select public.visible_associates()));
create policy leads_insert on public.leads for insert to authenticated
  with check (owner_id in (select public.visible_associates()));
create policy leads_update on public.leads for update to authenticated
  using (owner_id in (select public.visible_associates()))
  with check (owner_id in (select public.visible_associates()));

-- ================================================================ interactions
create policy interactions_select on public.interactions for select to authenticated
  using (associate_id in (select public.visible_associates()));
create policy interactions_insert on public.interactions for insert to authenticated
  with check (associate_id in (select public.visible_associates())
              and lead_id in (select id from public.leads));          -- leads RLS applies here
create policy interactions_update on public.interactions for update to authenticated
  using (associate_id in (select public.visible_associates()))
  with check (associate_id in (select public.visible_associates()));

create policy cp_interactions_select on public.cp_interactions for select to authenticated
  using (associate_id in (select public.visible_associates()));
create policy cp_interactions_insert on public.cp_interactions for insert to authenticated
  with check (associate_id in (select public.visible_associates())
              and cp_id in (select id from public.channel_partners));
create policy cp_interactions_update on public.cp_interactions for update to authenticated
  using (associate_id in (select public.visible_associates()))
  with check (associate_id in (select public.visible_associates()));

-- ================================================================ bookings
create policy bookings_select on public.bookings for select to authenticated
  using (associate_id in (select public.visible_associates()));
create policy bookings_insert on public.bookings for insert to authenticated
  with check (associate_id in (select public.visible_associates())
              and lead_id in (select id from public.leads));
create policy bookings_update on public.bookings for update to authenticated
  using (associate_id in (select public.visible_associates()))
  with check (associate_id in (select public.visible_associates()));

-- history rows are written only by triggers
create policy booking_history_select on public.booking_status_history for select to authenticated
  using (associate_id in (select public.visible_associates()));

-- ================================================================ targets (set by reviewers for people below them)
create policy targets_select on public.targets for select to authenticated
  using (associate_id in (select public.visible_associates()));
create policy targets_insert on public.targets for insert to authenticated
  with check (public.is_reviewer() and associate_id in (select public.visible_associates()));
create policy targets_update on public.targets for update to authenticated
  using (public.is_reviewer() and associate_id in (select public.visible_associates()))
  with check (public.is_reviewer() and associate_id in (select public.visible_associates()));

-- ================================================================ review sessions & actions
create policy review_sessions_select on public.review_sessions for select to authenticated
  using (public.is_reviewer() and (created_by = auth.uid()
         or (public.is_admin() and (branch_id = public.my_branch() or public.my_role() = 'super_admin'))));
create policy review_sessions_insert on public.review_sessions for insert to authenticated
  with check (public.is_reviewer() and (branch_id = public.my_branch() or public.my_role() = 'super_admin'));
create policy review_sessions_update on public.review_sessions for update to authenticated
  using (public.is_reviewer() and (created_by = auth.uid()
         or (public.is_admin() and (branch_id = public.my_branch() or public.my_role() = 'super_admin'))))
  with check (public.is_reviewer());

-- the person who must act can see (and tick off) their own actions
create policy review_actions_select on public.review_actions for select to authenticated
  using (associate_id in (select public.visible_associates()) or created_by = auth.uid());
create policy review_actions_insert on public.review_actions for insert to authenticated
  with check (public.is_reviewer() and associate_id in (select public.visible_associates()));
create policy review_actions_update on public.review_actions for update to authenticated
  using (associate_id in (select public.visible_associates()) or created_by = auth.uid())
  with check (associate_id in (select public.visible_associates()) or created_by = auth.uid());

-- ================================================================ audit log (read-only for admins)
create policy audit_log_select on public.audit_log for select to authenticated
  using (public.is_admin() and (branch_id = public.my_branch() or public.my_role() = 'super_admin'));
