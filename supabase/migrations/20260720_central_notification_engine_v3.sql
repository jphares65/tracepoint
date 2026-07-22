-- TracePoint Central Notification Engine v3
create extension if not exists pgcrypto;

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_key text not null,
  source text not null,
  kind text not null,
  title text not null,
  detail text not null,
  href text not null,
  priority text not null default 'Normal',
  fingerprint text not null,
  source_created_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  snoozed_until timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists notification_events_user_key_uidx on public.notification_events (department_id, user_id, notification_key);
create index if not exists notification_events_open_idx on public.notification_events (department_id, user_id, resolved_at, priority, last_seen_at desc);

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default false,
  critical_email_only boolean not null default true,
  digest_mode text not null default 'Immediate',
  source_preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists notification_preferences_user_uidx on public.notification_preferences (department_id, user_id);

create table if not exists public.notification_email_queue (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  notification_key text not null,
  fingerprint text not null,
  subject text not null,
  body_text text not null,
  scheduled_for timestamptz not null default now(),
  status text not null default 'Pending',
  attempt_count integer not null default 0,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists notification_email_queue_fingerprint_uidx on public.notification_email_queue (department_id, user_id, notification_key, fingerprint);

alter table public.notification_events enable row level security;
alter table public.notification_preferences enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notification_events' and policyname='notification_events_own') then
    create policy notification_events_own on public.notification_events for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notification_preferences' and policyname='notification_preferences_own') then
    create policy notification_preferences_own on public.notification_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

grant select, insert, update on public.notification_events to authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
