begin;
-- No users are imported, linked by email, activated or switched by this migration.
-- Existing TracePoint profile UUIDs remain the stable membership/history keys.
create table public.authentication_identity_links (
 provider text not null check(provider in ('supabase','cognito')),
 issuer text not null check(length(issuer) between 1 and 512),
 subject text not null check(length(subject) between 1 and 256),
 tracepoint_user_id uuid not null references public.profiles(id) on delete cascade,
 state text not null default 'pending' check(state in ('pending','active','revoked')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(provider,issuer,subject), unique(provider,issuer,tracepoint_user_id)
);
alter table public.authentication_identity_links enable row level security;
revoke all on public.authentication_identity_links from anon,authenticated;
grant select,insert,update,delete on public.authentication_identity_links to service_role;
commit;
