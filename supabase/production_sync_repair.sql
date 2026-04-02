create extension if not exists pgcrypto;

alter table public.force_history
  add column if not exists id uuid;

update public.force_history
set id = gen_random_uuid()
where id is null;

alter table public.force_history
  alter column id set default gen_random_uuid();

create unique index if not exists force_history_id_key
on public.force_history (id);

alter table public.force_history enable row level security;

drop policy if exists "force_history_read_authenticated" on public.force_history;
drop policy if exists "force_history_write_admin_sergeant" on public.force_history;
drop policy if exists "force_history_write_authenticated" on public.force_history;

create policy "force_history_read_authenticated"
on public.force_history
for select
to authenticated
using (true);

create policy "force_history_write_authenticated"
on public.force_history
for all
to authenticated
using (true)
with check (true);

alter table public.overtime_shift_requests
  add column if not exists off_reason text;

alter table public.overtime_shift_requests
  add column if not exists assigned_hours text;

alter table public.overtime_shift_requests
  add column if not exists manually_queued boolean not null default false;

alter table public.overtime_shift_requests
  add column if not exists auto_assign_reason text;

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

alter table public.notification_provider_config enable row level security;

drop policy if exists "notification_provider_config_read_authenticated" on public.notification_provider_config;
drop policy if exists "notification_provider_config_write_admin_sergeant" on public.notification_provider_config;
drop policy if exists "notification_provider_config_write_authenticated" on public.notification_provider_config;

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

update public.notification_provider_config
set
  sender_name = coalesce(nullif(sender_name, ''), 'Androscoggin Scheduler'),
  updated_at = now()
where config_key = 'default';

create index if not exists patrol_schedule_assignment_date_idx
on public.patrol_schedule (assignment_date);

create index if not exists patrol_overrides_assignment_date_idx
on public.patrol_overrides (assignment_date);

create index if not exists patrol_schedule_assignment_slot_idx
on public.patrol_schedule (assignment_date, shift_type, position_code);

create index if not exists patrol_overrides_assignment_slot_idx
on public.patrol_overrides (assignment_date, shift_type, position_code);

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role',
    'deputy'
  );
$$;

revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to authenticated;

create or replace function public.is_admin_or_sergeant()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() in ('admin', 'sergeant');
$$;

revoke all on function public.is_admin_or_sergeant() from public;
grant execute on function public.is_admin_or_sergeant() to authenticated;
