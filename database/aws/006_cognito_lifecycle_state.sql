begin;

alter table public.authentication_identity_links
  add column if not exists provider_username text;
alter table public.authentication_identity_links
  add constraint authentication_identity_links_provider_username_length
  check (provider_username is null or length(provider_username) between 1 and 256);
create unique index if not exists authentication_identity_links_provider_username_unique
  on public.authentication_identity_links(provider, issuer, provider_username)
  where provider_username is not null;

create table if not exists public.authentication_identity_events (
  id uuid primary key default gen_random_uuid(),
  tracepoint_user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('supabase','cognito')),
  issuer text not null check (length(issuer) between 1 and 512),
  subject text,
  provider_username text,
  event_type text not null check (event_type in ('prepared','linked','activated','disabled','enabled','revoked','compensated')),
  actor_user_id uuid references public.profiles(id) on delete set null,
  operation_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.authentication_lifecycle_operations (
  id uuid primary key,
  operation_kind text not null check (operation_kind in ('invite','activate','assign_password','reset_password','disable','enable','delete_compensation')),
  tracepoint_user_id uuid not null references public.profiles(id) on delete cascade,
  department_id uuid references public.departments(id) on delete cascade,
  provider_username text,
  provider_subject text,
  state text not null check (state in ('prepared','provider_succeeded','committed','compensation_required','failed')),
  attempts integer not null default 0 check (attempts between 0 and 100),
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.authentication_identity_events enable row level security;
alter table public.authentication_lifecycle_operations enable row level security;

create policy authentication_identity_events_runtime
on public.authentication_identity_events for all to tracepoint_runtime
using (true) with check (true);
create policy authentication_lifecycle_operations_runtime
on public.authentication_lifecycle_operations for all to tracepoint_runtime
using (true) with check (true);
create policy user_activation_tokens_runtime
on public.user_activation_tokens for all to tracepoint_runtime
using (true) with check (true);

grant select,insert on public.authentication_identity_events to tracepoint_runtime;
grant select,insert,update on public.authentication_lifecycle_operations to tracepoint_runtime;
grant select,insert,update on public.user_activation_tokens to tracepoint_runtime;
grant select,insert,update on public.authentication_identity_links to tracepoint_runtime;

create or replace function tracepoint_auth.upsert_application_user_anchor(
  p_user_id uuid,
  p_email text,
  p_full_name text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, auth
as $$
begin
  if session_user <> 'tracepoint_runtime' or p_user_id is null or nullif(btrim(p_email),'') is null then
    raise exception 'application identity anchor rejected' using errcode = '42501';
  end if;
  insert into auth.users(id,email,raw_user_meta_data)
  values(p_user_id,lower(btrim(p_email)),jsonb_build_object('full_name',btrim(coalesce(p_full_name,'')),'identity_provider','cognito'))
  on conflict(id) do update set
    email=excluded.email,
    raw_user_meta_data=auth.users.raw_user_meta_data||excluded.raw_user_meta_data;
end;
$$;
revoke all on function tracepoint_auth.upsert_application_user_anchor(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function tracepoint_auth.upsert_application_user_anchor(uuid,text,text) to tracepoint_runtime;

commit;
