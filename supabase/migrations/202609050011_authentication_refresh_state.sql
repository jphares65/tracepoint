begin;
-- Disabled provider state. No identity is imported and no active session changes.
create table public.authentication_refresh_sessions (
 family_id uuid primary key,
 provider text not null default 'cognito' check(provider='cognito'),
 issuer text not null, subject text not null,
 tracepoint_user_id uuid not null references public.profiles(id) on delete cascade,
 client_id text not null check(client_id ~ '^[A-Za-z0-9]{1,128}$'),
 handle_hash text not null unique check(handle_hash ~ '^[0-9a-f]{64}$'),
 generation integer not null default 0 check(generation>=0),
 state text not null default 'ready' check(state in ('ready','consumed','revoked')),
 sealed_payload text,
 authenticated_at timestamptz not null, expires_at timestamptz not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(provider,issuer,subject) references public.authentication_identity_links(provider,issuer,subject) on delete cascade,
 check(expires_at>authenticated_at and expires_at<=authenticated_at+interval '24 hours'),
 check((state='ready' and sealed_payload is not null and length(sealed_payload) between 1 and 32768) or
       (state in ('consumed','revoked') and sealed_payload is null))
);
create index authentication_refresh_expiry on public.authentication_refresh_sessions(expires_at);
alter table public.authentication_refresh_sessions enable row level security;
revoke all on public.authentication_refresh_sessions from anon,authenticated;
grant select,insert,update,delete on public.authentication_refresh_sessions to service_role;
commit;
