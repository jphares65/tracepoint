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
  event_type text not null check (event_type in ('prepared','linked','activated','password_assigned','password_reset','disabled','enabled','revoked','compensated')),
  actor_user_id uuid references public.profiles(id) on delete set null,
  operation_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.authentication_lifecycle_operations (
  id uuid primary key,
  operation_kind text not null check (operation_kind in ('invite','activate','assign_password','reset_password','disable','enable','delete_compensation')),
  tracepoint_user_id uuid not null references public.profiles(id) on delete cascade,
  department_id uuid references public.departments(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
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

create or replace function tracepoint_auth.prepare_cognito_invite(
  p_user_id uuid,p_operation_id uuid,p_provider_username text,p_department_id uuid,
  p_email text,p_full_name text,p_badge_number text,p_rank_title text,p_unit_name text,p_employee_number text,
  p_role_codes text[],p_group_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_actor uuid:=tracepoint_auth.subject_id();
begin
  if session_user<>'tracepoint_runtime' or v_actor is null or nullif(btrim(p_email),'') is null or nullif(btrim(p_full_name),'') is null or coalesce(array_length(p_role_codes,1),0)=0 then raise exception 'invite rejected' using errcode='22023'; end if;
  if not (public.has_department_permission(p_department_id,'manage_users') or public.has_department_permission(p_department_id,'administer_department')) then raise exception 'invite forbidden' using errcode='42501'; end if;
  if 'administrator'=any(p_role_codes) and not public.has_department_permission(p_department_id,'administer_department') then raise exception 'administrator assignment forbidden' using errcode='42501'; end if;
  if exists(select 1 from public.profiles where lower(email)=lower(btrim(p_email))) then raise exception 'explicit existing identity selection required' using errcode='23505'; end if;
  if (select count(*) from public.roles where code=any(p_role_codes))<>cardinality(p_role_codes) then raise exception 'invalid roles' using errcode='22023'; end if;
  if exists(select 1 from unnest(coalesce(p_group_ids,array[]::uuid[])) g where not exists(select 1 from public.department_groups d where d.id=g and d.department_id=p_department_id and d.is_active)) then raise exception 'invalid groups' using errcode='22023'; end if;
  insert into auth.users(id,email,raw_user_meta_data) values(p_user_id,lower(btrim(p_email)),jsonb_build_object('full_name',btrim(p_full_name),'identity_provider','cognito'));
  insert into public.profiles(id,full_name,email) values(p_user_id,btrim(p_full_name),lower(btrim(p_email)));
  insert into public.department_memberships(department_id,user_id,badge_number,rank_title,unit_name,employee_number,is_active,activation_status)
    values(p_department_id,p_user_id,nullif(btrim(p_badge_number),''),nullif(btrim(p_rank_title),''),nullif(btrim(p_unit_name),''),nullif(btrim(p_employee_number),''),true,'pending_activation');
  insert into public.department_membership_roles(department_id,user_id,role_code) select p_department_id,p_user_id,unnest(p_role_codes);
  insert into public.department_group_members(department_id,group_id,user_id,assigned_by) select p_department_id,unnest(coalesce(p_group_ids,array[]::uuid[])),p_user_id,v_actor;
  insert into public.authentication_lifecycle_operations(id,operation_kind,tracepoint_user_id,department_id,actor_user_id,provider_username,state)
    values(p_operation_id,'invite',p_user_id,p_department_id,v_actor,p_provider_username,'prepared');
end;
$$;
revoke all on function tracepoint_auth.prepare_cognito_invite(uuid,uuid,text,uuid,text,text,text,text,text,text,text[],uuid[]) from public,anon,service_role;
grant execute on function tracepoint_auth.prepare_cognito_invite(uuid,uuid,text,uuid,text,text,text,text,text,text,text[],uuid[]) to authenticated;

create or replace function tracepoint_auth.commit_cognito_invite(p_operation_id uuid,p_subject text,p_issuer text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_op public.authentication_lifecycle_operations%rowtype;
begin
 if session_user<>'tracepoint_runtime' or nullif(btrim(p_subject),'') is null then raise exception 'invite commit rejected' using errcode='42501'; end if;
 select * into v_op from public.authentication_lifecycle_operations where id=p_operation_id and operation_kind='invite' and state='prepared' for update;
 if not found then raise exception 'invite operation unavailable' using errcode='P0002'; end if;
 insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state,provider_username)
 values('cognito',p_issuer,p_subject,v_op.tracepoint_user_id,'pending',v_op.provider_username);
 insert into public.authentication_identity_events(tracepoint_user_id,provider,issuer,subject,provider_username,event_type,actor_user_id,operation_id)
 values(v_op.tracepoint_user_id,'cognito',p_issuer,p_subject,v_op.provider_username,'linked',v_op.actor_user_id,v_op.id);
 update public.authentication_lifecycle_operations set provider_subject=p_subject,state='provider_succeeded',attempts=attempts+1,updated_at=now() where id=v_op.id;
end;$$;
revoke all on function tracepoint_auth.commit_cognito_invite(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function tracepoint_auth.commit_cognito_invite(uuid,text,text) to tracepoint_runtime;

create or replace function tracepoint_auth.finish_cognito_invite(p_operation_id uuid,p_sent boolean,p_error_code text default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_op public.authentication_lifecycle_operations%rowtype;
begin
 if session_user<>'tracepoint_runtime' then raise exception 'invite finish rejected' using errcode='42501'; end if;
 select * into v_op from public.authentication_lifecycle_operations where id=p_operation_id and operation_kind='invite' for update;
 if not found then raise exception 'invite operation unavailable' using errcode='P0002'; end if;
 if p_sent then
   update public.department_memberships set activation_status='activation_sent' where department_id=v_op.department_id and user_id=v_op.tracepoint_user_id and is_active;
   update public.authentication_lifecycle_operations set state='committed',safe_error_code=null,updated_at=now() where id=v_op.id;
 else
   update public.authentication_lifecycle_operations set state='compensation_required',safe_error_code=left(coalesce(p_error_code,'email_unconfirmed'),80),updated_at=now() where id=v_op.id;
 end if;
end;$$;
revoke all on function tracepoint_auth.finish_cognito_invite(uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function tracepoint_auth.finish_cognito_invite(uuid,boolean,text) to tracepoint_runtime;

create or replace function tracepoint_auth.prepare_cognito_password_operation(
  p_operation_id uuid,
  p_operation_kind text,
  p_department_id uuid,
  p_target_user_id uuid default null,
  p_target_email text default null
) returns table(user_id uuid,provider_username text,provider_subject text,issuer text,email text,identity_state text)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_actor uuid:=tracepoint_auth.subject_id(); v_target uuid; v_matches integer; v_link public.authentication_identity_links%rowtype;
begin
  if session_user<>'tracepoint_runtime' or v_actor is null or p_operation_kind not in ('assign_password','reset_password') then
    raise exception 'password operation rejected' using errcode='22023';
  end if;
  if not (public.has_department_permission(p_department_id,'manage_users') or public.has_department_permission(p_department_id,'administer_department')) then
    raise exception 'password operation forbidden' using errcode='42501';
  end if;
  if current_setting('tracepoint.department_id',true) is distinct from p_department_id::text then
    raise exception 'active department mismatch' using errcode='42501';
  end if;
  if p_target_user_id is null then
    select count(*)::integer,(array_agg(m.user_id))[1] into v_matches,v_target
    from public.department_memberships m join public.profiles p on p.id=m.user_id
    where m.department_id=p_department_id and m.is_active and nullif(btrim(p_target_email),'') is not null and lower(p.email)=lower(btrim(p_target_email));
    if v_matches<>1 then raise exception 'target account unavailable' using errcode='P0002'; end if;
  else
  select m.user_id into v_target
  from public.department_memberships m
  where m.department_id=p_department_id and m.is_active and m.user_id=p_target_user_id
  limit 1;
  end if;
  if v_target is null then raise exception 'target account unavailable' using errcode='P0002'; end if;
  if exists(select 1 from public.department_membership_roles r where r.department_id=p_department_id and r.user_id=v_target and r.role_code='administrator')
     and not public.has_department_permission(p_department_id,'administer_department') then
    raise exception 'administrator operation forbidden' using errcode='42501';
  end if;
  select l.* into v_link from public.authentication_identity_links l
  where l.tracepoint_user_id=v_target and l.provider='cognito'
    and ((p_operation_kind='assign_password' and l.state in ('pending','active')) or (p_operation_kind='reset_password' and l.state='active'))
  for update;
  if not found or nullif(v_link.provider_username,'') is null then raise exception 'cognito identity unavailable' using errcode='P0002'; end if;
  insert into public.authentication_lifecycle_operations(id,operation_kind,tracepoint_user_id,department_id,actor_user_id,provider_username,provider_subject,state)
    values(p_operation_id,p_operation_kind,v_target,p_department_id,v_actor,v_link.provider_username,v_link.subject,'prepared');
  insert into public.authentication_session_revocations(tracepoint_user_id,issuer,revoked_before)
    values(v_target,v_link.issuer,clock_timestamp())
    on conflict on constraint authentication_session_revocations_pkey do update
      set revoked_before=greatest(authentication_session_revocations.revoked_before,excluded.revoked_before);
  update public.authentication_access_sessions s set revoked_at=coalesce(s.revoked_at,clock_timestamp())
    where s.tracepoint_user_id=v_target and s.issuer=v_link.issuer;
  update public.authentication_refresh_sessions s set state='revoked',sealed_payload=null,updated_at=clock_timestamp()
    where s.tracepoint_user_id=v_target and s.issuer=v_link.issuer and s.state<>'revoked';
  return query select v_target,v_link.provider_username,v_link.subject,v_link.issuer,p.email,v_link.state from public.profiles p where p.id=v_target;
end;$$;
revoke all on function tracepoint_auth.prepare_cognito_password_operation(uuid,text,uuid,uuid,text) from public,anon,service_role;
grant execute on function tracepoint_auth.prepare_cognito_password_operation(uuid,text,uuid,uuid,text) to authenticated;

create or replace function tracepoint_auth.finish_cognito_password_operation(
  p_operation_id uuid,p_succeeded boolean,p_error_code text default null
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_op public.authentication_lifecycle_operations%rowtype; v_email text;
begin
  if session_user<>'tracepoint_runtime' then raise exception 'password operation finish rejected' using errcode='42501'; end if;
  select * into v_op from public.authentication_lifecycle_operations where id=p_operation_id and operation_kind in ('assign_password','reset_password') for update;
  if not found then raise exception 'password operation unavailable' using errcode='P0002'; end if;
  if not p_succeeded then
    update public.authentication_lifecycle_operations set state='compensation_required',attempts=attempts+1,safe_error_code=left(coalesce(p_error_code,'provider_unavailable'),80),updated_at=now() where id=v_op.id;
    return;
  end if;
  select email into v_email from public.profiles where id=v_op.tracepoint_user_id;
  if v_op.operation_kind='assign_password' then
    update public.department_memberships set activation_status='activated'
      where department_id=v_op.department_id and user_id=v_op.tracepoint_user_id and is_active;
    update public.authentication_identity_links set state='active',updated_at=now()
      where provider='cognito' and tracepoint_user_id=v_op.tracepoint_user_id and provider_username=v_op.provider_username;
    update public.user_activation_tokens set revoked_at=coalesce(revoked_at,now())
      where department_id=v_op.department_id and user_id=v_op.tracepoint_user_id and used_at is null;
  end if;
  insert into public.authentication_identity_events(tracepoint_user_id,provider,issuer,subject,provider_username,event_type,actor_user_id,operation_id)
    select v_op.tracepoint_user_id,'cognito',l.issuer,l.subject,l.provider_username,
      case when v_op.operation_kind='assign_password' then 'password_assigned' else 'password_reset' end,v_op.actor_user_id,v_op.id
    from public.authentication_identity_links l where l.provider='cognito' and l.tracepoint_user_id=v_op.tracepoint_user_id;
  insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,summary,new_value)
    values(v_op.department_id,v_op.actor_user_id,case when v_op.operation_kind='assign_password' then 'user_password_assigned' else 'password_reset_sent' end,
      'department_membership',v_op.tracepoint_user_id,
      case when v_op.operation_kind='assign_password' then 'An administrator assigned a new password.' else 'An administrator initiated a Cognito password reset.' end,
      jsonb_build_object('target_user_id',v_op.tracepoint_user_id,'target_email',v_email,'identity_provider','cognito'));
  update public.authentication_lifecycle_operations set state='committed',attempts=attempts+1,safe_error_code=null,updated_at=now() where id=v_op.id;
end;$$;
revoke all on function tracepoint_auth.finish_cognito_password_operation(uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function tracepoint_auth.finish_cognito_password_operation(uuid,boolean,text) to tracepoint_runtime;

commit;
