create extension if not exists pgcrypto;

create table if not exists public.app_state (
  state_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.patrol_overrides (
  assignment_date date not null,
  shift_type text not null,
  position_code text not null,
  employee_id uuid,
  vehicle text,
  shift_hours text,
  status text,
  replacement_employee_id uuid,
  replacement_vehicle text,
  replacement_hours text,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (assignment_date, shift_type, position_code)
);

create table if not exists public.overtime_queue (
  employee_id text primary key,
  queue_position integer not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.overtime_shift_requests (
  id text primary key,
  source text not null,
  batch_id text,
  batch_name text,
  assignment_date date not null,
  shift_type text not null,
  position_code text not null,
  description text not null default '',
  off_employee_id text,
  off_employee_last_name text,
  off_hours text,
  off_reason text,
  assigned_hours text,
  selection_active boolean not null default false,
  manually_queued boolean not null default false,
  auto_assign_reason text,
  workflow_status text,
  status text not null,
  assigned_employee_id text,
  created_at timestamptz not null default timezone('utc', now()),
  responses jsonb not null default '[]'::jsonb
);

alter table public.overtime_shift_requests
  add column if not exists off_reason text;

alter table public.overtime_shift_requests
  add column if not exists assigned_hours text;

alter table public.overtime_shift_requests
  add column if not exists manually_queued boolean not null default false;

alter table public.overtime_shift_requests
  add column if not exists auto_assign_reason text;

create table if not exists public.overtime_entries (
  id text primary key,
  employee_id text not null,
  date date not null,
  hours numeric not null default 0,
  reason text not null default '',
  source text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.notification_preferences (
  employee_id text primary key,
  email_address text not null default '',
  phone_number text not null default '',
  allow_email boolean not null default true,
  allow_text boolean not null default false,
  overtime_availability boolean not null default true,
  overtime_assignment boolean not null default true,
  patrol_updates boolean not null default false,
  force_updates boolean not null default false,
  detail_updates boolean not null default false
);

create table if not exists public.notification_campaigns (
  id text primary key,
  title text not null,
  type text not null,
  channel text not null,
  recipient_ids jsonb not null default '[]'::jsonb,
  shift_request_ids jsonb not null default '[]'::jsonb,
  status text not null,
  created_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  notes text
);

create table if not exists public.notification_deliveries (
  id text primary key,
  campaign_id text not null,
  employee_id text not null,
  channel text not null,
  destination text not null default '',
  shift_request_ids jsonb not null default '[]'::jsonb,
  response_token text,
  subject text not null default '',
  body text not null default '',
  status text not null,
  provider_mode text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  error_message text
);

create table if not exists public.notification_provider_config (
  config_key text primary key,
  mode text not null default 'draft_only',
  email_webhook_url text not null default '',
  text_webhook_url text not null default '',
  auth_token text not null default '',
  sender_name text not null default '',
  sender_email text not null default '',
  sender_phone text not null default '',
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.notification_provider_config (
  config_key,
  mode,
  email_webhook_url,
  text_webhook_url,
  auth_token,
  sender_name,
  sender_email,
  sender_phone
)
values (
  'default',
  'draft_only',
  '',
  '',
  '',
  'Androscoggin Scheduler',
  '',
  ''
)
on conflict (config_key) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  role text not null default 'deputy' check (role in ('admin', 'sergeant', 'detective', 'deputy')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(
      nullif(new.raw_app_meta_data ->> 'role', ''),
      nullif(new.raw_user_meta_data ->> 'role', ''),
      'deputy'
    )
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        role = excluded.role,
        updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.current_app_role()
returns text
language sql
stable
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role',
    'deputy'
  );
$$;

create or replace function public.is_admin_or_sergeant()
returns boolean
language sql
stable
as $$
  select public.current_app_role() in ('admin', 'sergeant');
$$;

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin_or_sergeant());

drop policy if exists "profiles_update_admin_sergeant" on public.profiles;
create policy "profiles_update_admin_sergeant"
on public.profiles
for update
to authenticated
using (public.is_admin_or_sergeant())
with check (public.is_admin_or_sergeant());

drop policy if exists "profiles_insert_admin_sergeant" on public.profiles;
create policy "profiles_insert_admin_sergeant"
on public.profiles
for insert
to authenticated
with check (public.is_admin_or_sergeant());

alter table public.app_state enable row level security;
alter table public.patrol_overrides enable row level security;
alter table public.overtime_queue enable row level security;
alter table public.overtime_shift_requests enable row level security;
alter table public.overtime_entries enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_campaigns enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_provider_config enable row level security;

drop policy if exists "Allow anon read app_state" on public.app_state;
drop policy if exists "Allow anon write app_state" on public.app_state;
drop policy if exists "Allow anon update app_state" on public.app_state;

drop policy if exists "app_state_read_authenticated" on public.app_state;
create policy "app_state_read_authenticated"
on public.app_state
for select
to authenticated
using (true);

drop policy if exists "app_state_write_admin_sergeant" on public.app_state;
drop policy if exists "app_state_write_authenticated" on public.app_state;
create policy "app_state_write_authenticated"
on public.app_state
for insert
to authenticated
with check (true);

drop policy if exists "app_state_update_admin_sergeant" on public.app_state;
drop policy if exists "app_state_update_authenticated" on public.app_state;
drop policy if exists "patrol_overrides_read_authenticated" on public.patrol_overrides;
drop policy if exists "patrol_overrides_write_admin_sergeant" on public.patrol_overrides;
drop policy if exists "overtime_queue_read_authenticated" on public.overtime_queue;
drop policy if exists "overtime_queue_write_admin_sergeant" on public.overtime_queue;
drop policy if exists "overtime_shift_requests_read_authenticated" on public.overtime_shift_requests;
drop policy if exists "overtime_shift_requests_write_admin_sergeant" on public.overtime_shift_requests;
drop policy if exists "overtime_entries_read_authenticated" on public.overtime_entries;
drop policy if exists "overtime_entries_write_admin_sergeant" on public.overtime_entries;
drop policy if exists "notification_preferences_read_authenticated" on public.notification_preferences;
drop policy if exists "notification_preferences_write_admin_sergeant" on public.notification_preferences;
drop policy if exists "notification_campaigns_read_authenticated" on public.notification_campaigns;
drop policy if exists "notification_campaigns_write_admin_sergeant" on public.notification_campaigns;
drop policy if exists "notification_deliveries_read_authenticated" on public.notification_deliveries;
drop policy if exists "notification_deliveries_write_admin_sergeant" on public.notification_deliveries;
drop policy if exists "notification_provider_config_read_authenticated" on public.notification_provider_config;
drop policy if exists "notification_provider_config_write_admin_sergeant" on public.notification_provider_config;
drop policy if exists "notification_provider_config_write_authenticated" on public.notification_provider_config;
create policy "app_state_update_authenticated"
on public.app_state
for update
to authenticated
using (true)
with check (true);

create policy "patrol_overrides_read_authenticated"
on public.patrol_overrides
for select
to authenticated
using (true);

create policy "patrol_overrides_write_admin_sergeant"
on public.patrol_overrides
for all
to authenticated
using (public.is_admin_or_sergeant())
with check (public.is_admin_or_sergeant());

create policy "overtime_queue_read_authenticated"
on public.overtime_queue
for select
to authenticated
using (true);

create policy "overtime_queue_write_admin_sergeant"
on public.overtime_queue
for all
to authenticated
using (public.is_admin_or_sergeant())
with check (public.is_admin_or_sergeant());

create policy "overtime_shift_requests_read_authenticated"
on public.overtime_shift_requests
for select
to authenticated
using (true);

create policy "overtime_shift_requests_write_admin_sergeant"
on public.overtime_shift_requests
for all
to authenticated
using (public.is_admin_or_sergeant())
with check (public.is_admin_or_sergeant());

create policy "overtime_entries_read_authenticated"
on public.overtime_entries
for select
to authenticated
using (true);

create policy "overtime_entries_write_admin_sergeant"
on public.overtime_entries
for all
to authenticated
using (public.is_admin_or_sergeant())
with check (public.is_admin_or_sergeant());

create policy "notification_preferences_read_authenticated"
on public.notification_preferences
for select
to authenticated
using (true);

create policy "notification_preferences_write_admin_sergeant"
on public.notification_preferences
for all
to authenticated
using (public.is_admin_or_sergeant())
with check (public.is_admin_or_sergeant());

create policy "notification_campaigns_read_authenticated"
on public.notification_campaigns
for select
to authenticated
using (true);

create policy "notification_campaigns_write_admin_sergeant"
on public.notification_campaigns
for all
to authenticated
using (public.is_admin_or_sergeant())
with check (public.is_admin_or_sergeant());

create policy "notification_deliveries_read_authenticated"
on public.notification_deliveries
for select
to authenticated
using (true);

create policy "notification_deliveries_write_admin_sergeant"
on public.notification_deliveries
for all
to authenticated
using (public.is_admin_or_sergeant())
with check (public.is_admin_or_sergeant());

create policy "notification_provider_config_read_authenticated"
on public.notification_provider_config
for select
to authenticated
using (true);

create policy "notification_provider_config_write_authenticated"
on public.notification_provider_config
for all
to authenticated
using (true)
with check (true);

alter table public.patrol_schedule enable row level security;

drop policy if exists "patrol_schedule_read_authenticated" on public.patrol_schedule;
create policy "patrol_schedule_read_authenticated"
on public.patrol_schedule
for select
to authenticated
using (true);

drop policy if exists "patrol_schedule_write_admin_sergeant" on public.patrol_schedule;
create policy "patrol_schedule_write_admin_sergeant"
on public.patrol_schedule
for all
to authenticated
using (public.is_admin_or_sergeant())
with check (public.is_admin_or_sergeant());

alter table public.force_history enable row level security;

drop policy if exists "force_history_read_authenticated" on public.force_history;
create policy "force_history_read_authenticated"
on public.force_history
for select
to authenticated
using (true);

drop policy if exists "force_history_write_admin_sergeant" on public.force_history;
create policy "force_history_write_admin_sergeant"
on public.force_history
for all
to authenticated
using (public.is_admin_or_sergeant())
with check (public.is_admin_or_sergeant());

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  action text not null,
  summary text not null,
  details text,
  actor_role text not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.audit_log enable row level security;

drop policy if exists "audit_log_read_admin_sergeant" on public.audit_log;
create policy "audit_log_read_admin_sergeant"
on public.audit_log
for select
to authenticated
using (public.is_admin_or_sergeant());

drop policy if exists "audit_log_write_admin_sergeant" on public.audit_log;
create policy "audit_log_write_admin_sergeant"
on public.audit_log
for insert
to authenticated
with check (public.is_admin_or_sergeant());
