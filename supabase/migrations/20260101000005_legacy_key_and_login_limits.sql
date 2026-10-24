-- Branch Review OS - migration 5: link to the legacy Excel users + login rate limiting.

-- ---------------------------------------------------------------- legacy_key
-- The `user_key` from the import workbook ('parul', 'udit', ...). Lets the data import
-- attach each Excel tab to the right profile without guessing from names.
alter table public.profiles add column legacy_key text;
create unique index profiles_legacy_key_uq on public.profiles (legacy_key) where legacy_key is not null;

-- legacy_key, like role and branch, can only be changed server-side with the service key.
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
    or new.legacy_key  is distinct from old.legacy_key
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

-- ---------------------------------------------------------------- login attempts
-- Written and read ONLY by the server (service key). RLS is on with no policies,
-- and all browser roles are revoked, so nobody can read who tried to log in.
create table public.login_attempts (
  id         bigint generated always as identity primary key,
  email      text not null,
  ip         text not null,
  succeeded  boolean not null,
  at         timestamptz not null default now()
);
create index login_attempts_email_idx on public.login_attempts (email, at desc);
create index login_attempts_ip_idx    on public.login_attempts (ip, at desc);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated, public;
grant all on public.login_attempts to service_role;
