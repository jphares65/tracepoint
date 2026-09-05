begin;
-- Disabled SES foundation: no provider selection changes or existing data edits.
-- Address digests are sensitive pseudonymous metadata; clients get no access.
create table public.email_provider_acceptances (
 message_id text primary key check(length(message_id) between 1 and 256),
 department_id uuid not null references public.departments(id) on delete cascade,
 recipient_hashes text[] not null check(cardinality(recipient_hashes) between 1 and 50),
 created_at timestamptz not null default now()
);
create table public.email_provider_events (
 event_id text primary key check(event_id ~ '^[0-9a-f]{64}$'),
 message_id text not null references public.email_provider_acceptances(message_id) on delete cascade,
 department_id uuid not null references public.departments(id) on delete cascade,
 event_kind text not null check(event_kind in ('Delivery','Bounce','Complaint')),
 created_at timestamptz not null default now()
);
create table public.email_suppressions (
 recipient_hash text primary key check(recipient_hash ~ '^[0-9a-f]{64}$'),
 reason text not null check(reason in ('Bounce','Complaint','OptOut')),
 -- Intentionally independent of tenant deletion: deleting a department must
 -- never silently unsuppress a complaint or a permanently failing address.
 source_event_id text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.email_provider_acceptances enable row level security;
alter table public.email_provider_events enable row level security;
alter table public.email_suppressions enable row level security;
revoke all on public.email_provider_acceptances, public.email_provider_events, public.email_suppressions from anon,authenticated;
grant select,insert,update,delete on public.email_provider_acceptances, public.email_provider_events, public.email_suppressions to service_role;
commit;
