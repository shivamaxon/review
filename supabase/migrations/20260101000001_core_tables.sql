-- Branch Review OS - migration 1: types, organisation tables, config tables.
-- Conventions: every table has id, created_by, created_at, updated_at, deleted_at (soft delete).
-- Nothing is ever hard-deleted by the app.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------- enums
create type public.user_role         as enum ('associate', 'team_lead', 'branch_admin', 'super_admin');
create type public.rating            as enum ('hot', 'warm', 'cold');                    -- customers
create type public.cp_rating         as enum ('active', 'hot', 'warm', 'cold');          -- channel partners
create type public.meeting_mode      as enum ('in_person', 'virtual', 'both');
create type public.interaction_type  as enum ('meeting', 'follow_up');
create type public.booking_status    as enum ('token', 'booking_done', 'agreement_signed', 'cancelled');
create type public.lead_source       as enum ('cp', 'direct', 'referral', 'walk_in');

-- ---------------------------------------------------------------- shared trigger fn
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- branches
create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index branches_name_uq on public.branches (lower(name)) where deleted_at is null;

-- ---------------------------------------------------------------- profiles (1:1 with auth.users)
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  branch_id            uuid not null references public.branches (id),
  full_name            text not null,
  email                text,
  phone                text,
  role                 public.user_role not null default 'associate',
  designation          text,
  reports_to           uuid references public.profiles (id) on delete set null,
  active               boolean not null default true,
  must_change_password boolean not null default true,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  constraint profiles_no_self_report check (reports_to is distinct from id)
);
create index profiles_branch_idx     on public.profiles (branch_id);
create index profiles_reports_to_idx on public.profiles (reports_to);
create index profiles_role_idx       on public.profiles (role);

-- ---------------------------------------------------------------- projects (company-wide)
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location    text,
  active      boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index projects_name_uq on public.projects (lower(name)) where deleted_at is null;

-- ---------------------------------------------------------------- config tables
create table public.cold_reasons (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index cold_reasons_label_uq on public.cold_reasons (lower(label)) where deleted_at is null;

create table public.next_action_types (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index next_action_types_label_uq on public.next_action_types (lower(label)) where deleted_at is null;

-- A review cycle is a list of day-ranges inside every month. end_day NULL = "until month end".
create table public.review_cycle (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches (id),
  label       text not null,
  start_day   smallint not null check (start_day between 1 and 31),
  end_day     smallint check (end_day between 1 and 31),
  sort_order  int not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint review_cycle_order check (end_day is null or end_day >= start_day)
);
create unique index review_cycle_label_uq on public.review_cycle (branch_id, lower(label)) where deleted_at is null;

-- ---------------------------------------------------------------- channel partners (branch directory)
create table public.channel_partners (
  id               uuid primary key default gen_random_uuid(),
  branch_id        uuid not null references public.branches (id),
  name             text not null,
  firm             text,
  phone            text,
  current_rating   public.cp_rating not null default 'cold',
  normalized_key   text not null,                      -- dedupe key, maintained by trigger
  last_touch_at    timestamptz,
  next_action      text,
  next_action_date date,
  raw_json         jsonb,
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create unique index channel_partners_key_uq on public.channel_partners (branch_id, normalized_key) where deleted_at is null;
create index channel_partners_branch_idx  on public.channel_partners (branch_id);
create index channel_partners_rating_idx  on public.channel_partners (branch_id, current_rating);
create index channel_partners_name_trgm   on public.channel_partners using gin (name extensions.gin_trgm_ops);

-- ---------------------------------------------------------------- leads (one row per customer)
create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  branch_id        uuid not null references public.branches (id),
  name             text not null,
  phone            text,
  project_id       uuid references public.projects (id),
  owner_id         uuid not null references public.profiles (id) default auth.uid(),
  source           public.lead_source,
  cp_id            uuid references public.channel_partners (id),
  current_rating   public.rating not null default 'cold',    -- maintained by trigger from interactions
  plot_names       text[] not null default '{}',
  next_action      text,                                     -- maintained by trigger
  next_action_date date,                                     -- maintained by trigger
  cold_reason      text,                                     -- maintained by trigger
  last_touch_at    timestamptz,                              -- maintained by trigger
  status           text not null default 'open' check (status in ('open', 'booked', 'lost')),
  raw_json         jsonb,                                    -- original spreadsheet row, for imports
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index leads_owner_idx         on public.leads (owner_id) where deleted_at is null;
create index leads_owner_rating_idx  on public.leads (owner_id, current_rating) where deleted_at is null;
create index leads_branch_idx        on public.leads (branch_id) where deleted_at is null;
create index leads_project_idx       on public.leads (project_id);
create index leads_cp_idx            on public.leads (cp_id);
create index leads_next_date_idx     on public.leads (next_action_date) where deleted_at is null;
create index leads_last_touch_idx    on public.leads (last_touch_at);
create index leads_phone_idx         on public.leads (branch_id, phone);
create index leads_name_trgm         on public.leads using gin (name extensions.gin_trgm_ops);

-- ---------------------------------------------------------------- interactions (append-only history)
-- rating_before / rating_after make Cold->Warm->Hot->Booked movement analysable.
create table public.interactions (
  id               uuid primary key default gen_random_uuid(),
  branch_id        uuid not null references public.branches (id),
  lead_id          uuid not null references public.leads (id),
  associate_id     uuid not null references public.profiles (id) default auth.uid(),
  interaction_type public.interaction_type not null default 'meeting',
  occurred_on      date not null default ((now() at time zone 'Asia/Kolkata')::date),
  mode             public.meeting_mode,
  rating_before    public.rating,                            -- NULL = first contact; filled by trigger
  rating_after     public.rating not null,
  remark           text,
  next_action      text,
  next_action_date date,
  plot_names       text[] not null default '{}',
  cold_reason      text,
  raw_json         jsonb,
  remark_tsv       tsvector generated always as (to_tsvector('simple', coalesce(remark, ''))) stored,
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default clock_timestamp(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index interactions_lead_idx       on public.interactions (lead_id, occurred_on desc, created_at desc);
create index interactions_assoc_date_idx on public.interactions (associate_id, occurred_on) where deleted_at is null;
create index interactions_branch_date_idx on public.interactions (branch_id, occurred_on) where deleted_at is null;
create index interactions_remark_fts     on public.interactions using gin (remark_tsv);

-- ---------------------------------------------------------------- CP interactions
create table public.cp_interactions (
  id               uuid primary key default gen_random_uuid(),
  branch_id        uuid not null references public.branches (id),
  cp_id            uuid not null references public.channel_partners (id),
  associate_id     uuid not null references public.profiles (id) default auth.uid(),
  occurred_on      date not null default ((now() at time zone 'Asia/Kolkata')::date),
  mode             public.meeting_mode,
  rating_before    public.cp_rating,
  rating_after     public.cp_rating not null,
  remark           text,
  next_action      text,
  next_action_date date,
  raw_json         jsonb,
  remark_tsv       tsvector generated always as (to_tsvector('simple', coalesce(remark, ''))) stored,
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default clock_timestamp(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index cp_interactions_cp_idx         on public.cp_interactions (cp_id, occurred_on desc, created_at desc);
create index cp_interactions_assoc_date_idx on public.cp_interactions (associate_id, occurred_on) where deleted_at is null;
create index cp_interactions_branch_date_idx on public.cp_interactions (branch_id, occurred_on) where deleted_at is null;
create index cp_interactions_remark_fts     on public.cp_interactions using gin (remark_tsv);

-- ---------------------------------------------------------------- bookings
create table public.bookings (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches (id),
  lead_id       uuid not null references public.leads (id),
  associate_id  uuid not null references public.profiles (id) default auth.uid(),
  project_id    uuid references public.projects (id),
  plot_no       text,
  value         numeric(14, 2) check (value is null or value >= 0),
  booking_date  date not null default ((now() at time zone 'Asia/Kolkata')::date),
  status        public.booking_status not null default 'token',
  source        public.lead_source,
  cp_id         uuid references public.channel_partners (id),
  cancel_reason text,
  remarks       text,
  raw_json      jsonb,
  remarks_tsv   tsvector generated always as (to_tsvector('simple', coalesce(remarks, '') || ' ' || coalesce(cancel_reason, ''))) stored,
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index bookings_assoc_date_idx on public.bookings (associate_id, booking_date) where deleted_at is null;
create index bookings_branch_date_idx on public.bookings (branch_id, booking_date) where deleted_at is null;
create index bookings_lead_idx       on public.bookings (lead_id);
create index bookings_status_idx     on public.bookings (status) where deleted_at is null;
create index bookings_cp_idx         on public.bookings (cp_id);
create index bookings_remarks_fts    on public.bookings using gin (remarks_tsv);

create table public.booking_status_history (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings (id),
  branch_id     uuid not null references public.branches (id),
  associate_id  uuid not null references public.profiles (id),   -- copied from booking, used by RLS
  status_before public.booking_status,
  status_after  public.booking_status not null,
  changed_by    uuid,
  changed_at    timestamptz not null default clock_timestamp(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index booking_history_booking_idx on public.booking_status_history (booking_id, changed_at);

-- ---------------------------------------------------------------- targets
create table public.targets (
  id                 uuid primary key default gen_random_uuid(),
  branch_id          uuid not null references public.branches (id),
  associate_id       uuid not null references public.profiles (id),
  month              date not null check (month = date_trunc('month', month)::date),
  bookings           int not null default 0 check (bookings >= 0),
  customer_meetings  int not null default 0 check (customer_meetings >= 0),
  cp_meetings        int not null default 0 check (cp_meetings >= 0),
  created_by         uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create unique index targets_assoc_month_uq on public.targets (associate_id, month) where deleted_at is null;

-- ---------------------------------------------------------------- review sessions / actions
create table public.review_sessions (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches (id),
  cycle_label   text,
  period_start  date not null,
  period_end    date not null,
  held_on       date,
  status        text not null default 'draft' check (status in ('draft', 'final')),
  summary       text,
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint review_sessions_period check (period_end >= period_start)
);
create index review_sessions_branch_idx on public.review_sessions (branch_id, period_start);

create table public.review_actions (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches (id),
  session_id    uuid references public.review_sessions (id),
  associate_id  uuid not null references public.profiles (id),   -- who must act
  lead_id       uuid references public.leads (id),
  cp_id         uuid references public.channel_partners (id),
  action        text not null,
  due_date      date,
  status        text not null default 'open' check (status in ('open', 'done', 'dropped')),
  completed_at  timestamptz,
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  action_tsv    tsvector generated always as (to_tsvector('simple', coalesce(action, ''))) stored
);
create index review_actions_assoc_idx   on public.review_actions (associate_id, status);
create index review_actions_session_idx on public.review_actions (session_id);
create index review_actions_fts         on public.review_actions using gin (action_tsv);

-- ---------------------------------------------------------------- audit log
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default clock_timestamp(),
  actor_id    uuid,
  branch_id   uuid,
  table_name  text not null,
  row_id      uuid,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb
);
create index audit_log_row_idx    on public.audit_log (table_name, row_id);
create index audit_log_branch_idx on public.audit_log (branch_id, at desc);
