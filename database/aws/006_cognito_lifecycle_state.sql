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

create or replace function tracepoint_auth.activation_context(p_token_id uuid)
returns table(
  id uuid, department_id uuid, user_id uuid, token_hash text,
  expires_at timestamptz, created_by_user_id uuid, created_at timestamptz,
  used_at timestamptz, revoked_at timestamptz, email text, full_name text,
  provider_username text, provider_subject text, identity_state text,
  membership_active boolean, activation_status text
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select t.id,t.department_id,t.user_id,t.token_hash,t.expires_at,t.created_by_user_id,t.created_at,t.used_at,t.revoked_at,
    p.email,p.full_name,l.provider_username,l.subject,l.state,m.is_active,m.activation_status
  from public.user_activation_tokens t
  join public.profiles p on p.id=t.user_id
  join public.department_memberships m on m.department_id=t.department_id and m.user_id=t.user_id
  join public.authentication_identity_links l on l.tracepoint_user_id=t.user_id and l.provider='cognito'
  where t.id=p_token_id and session_user='tracepoint_runtime'
  limit 1
$$;
revoke all on function tracepoint_auth.activation_context(uuid) from public,anon,authenticated,service_role;
grant execute on function tracepoint_auth.activation_context(uuid) to tracepoint_runtime;

create or replace function tracepoint_auth.finalize_cognito_activation(p_token_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_token public.user_activation_tokens%rowtype;
begin
  if session_user<>'tracepoint_runtime' then raise exception 'activation rejected' using errcode='42501'; end if;
  select * into v_token from public.user_activation_tokens where id=p_token_id and used_at is not null and revoked_at is null for update;
  if not found then raise exception 'activation token not claimed' using errcode='P0002'; end if;
  update public.department_memberships set activation_status='activated'
    where department_id=v_token.department_id and user_id=v_token.user_id and is_active=true
      and activation_status in ('pending_activation','activation_sent');
  update public.authentication_identity_links set state='active',updated_at=now()
    where provider='cognito' and tracepoint_user_id=v_token.user_id and state='pending';
  update public.user_activation_tokens set revoked_at=now()
    where department_id=v_token.department_id and user_id=v_token.user_id and id<>v_token.id and used_at is null and revoked_at is null;
  insert into public.authentication_identity_events(tracepoint_user_id,provider,issuer,subject,provider_username,event_type,actor_user_id)
    select tracepoint_user_id,provider,issuer,subject,provider_username,'activated',v_token.user_id
    from public.authentication_identity_links where provider='cognito' and tracepoint_user_id=v_token.user_id;
  insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,summary,new_value)
    select v_token.department_id,v_token.user_id,'account_activated','department_membership',v_token.user_id,
      coalesce(p.email,'TracePoint user')||' activated their TracePoint account.',jsonb_build_object('activation_status','activated','activation_token_id',v_token.id)
    from public.profiles p where p.id=v_token.user_id;
end;
$$;
revoke all on function tracepoint_auth.finalize_cognito_activation(uuid) from public,anon,authenticated,service_role;
grant execute on function tracepoint_auth.finalize_cognito_activation(uuid) to tracepoint_runtime;

commit;
