begin;
-- Disabled Cognito foundation; existing Supabase sessions are unchanged.
create table public.authentication_flow_transactions (
 handle_hash text primary key check(handle_hash ~ '^[0-9a-f]{64}$'),
 sealed_payload text not null check(length(sealed_payload) between 1 and 8192),
 expires_at timestamptz not null, created_at timestamptz not null default now(),
 check(expires_at > created_at and expires_at <= created_at + interval '6 minutes')
);
create index authentication_flow_expiry on public.authentication_flow_transactions(expires_at);
create table public.authentication_session_revocations (
 tracepoint_user_id uuid not null references public.profiles(id) on delete cascade,
 issuer text not null check(length(issuer) between 1 and 512),
 revoked_before timestamptz not null,
 primary key(tracepoint_user_id,issuer)
);
create table public.authentication_access_sessions (
 provider text not null default 'cognito' check(provider='cognito'),
 issuer text not null, subject text not null,
 tracepoint_user_id uuid not null references public.profiles(id) on delete cascade,
 token_id uuid not null, issued_at timestamptz not null, expires_at timestamptz not null,
 revoked_at timestamptz, created_at timestamptz not null default now(),
 primary key(issuer,token_id),
 foreign key(provider,issuer,subject) references public.authentication_identity_links(provider,issuer,subject) on delete cascade,
 check(expires_at>issued_at and expires_at<=issued_at+interval '15 minutes')
);
create index authentication_access_expiry on public.authentication_access_sessions(expires_at);
alter table public.authentication_flow_transactions enable row level security;
alter table public.authentication_session_revocations enable row level security;
alter table public.authentication_access_sessions enable row level security;
revoke all on public.authentication_flow_transactions,public.authentication_session_revocations,public.authentication_access_sessions from anon,authenticated;
grant select,insert,update,delete on public.authentication_flow_transactions,public.authentication_session_revocations,public.authentication_access_sessions to service_role;
commit;
