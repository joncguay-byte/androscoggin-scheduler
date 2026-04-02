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
