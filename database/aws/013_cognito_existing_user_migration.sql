begin;

alter table public.authentication_lifecycle_operations
  drop constraint if exists authentication_lifecycle_operations_operation_kind_check;
alter table public.authentication_lifecycle_operations
  add constraint authentication_lifecycle_operations_operation_kind_check
  check (operation_kind in ('invite','activate','assign_password','reset_password','disable','enable','delete_compensation','migrate_identity'));

create function tracepoint_auth.prepare_existing_cognito_migration(
  p_operation_id uuid,
  p_provider_username text,
  p_department_id uuid,
  p_target_user_id uuid
) returns table(email text, full_name text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := tracepoint_auth.subject_id();
  v_email text;
  v_full_name text;
  v_email_matches integer;
begin
  if session_user <> 'tracepoint_runtime'
     or v_actor is null
     or p_operation_id is null
     or p_target_user_id is null
     or nullif(btrim(p_provider_username), '') is null
     or current_setting('tracepoint.department_id', true) is distinct from p_department_id::text
     or not public.has_department_permission(p_department_id, 'administer_department') then
    raise exception 'identity migration forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.department_memberships
    where department_id = p_department_id and user_id = p_target_user_id and is_active
  ) then
    raise exception 'identity migration target unavailable' using errcode = 'P0002';
  end if;

  select lower(btrim(profile.email)), btrim(profile.full_name)
    into v_email, v_full_name
  from public.profiles profile
  where profile.id = p_target_user_id
  for update;

  if nullif(v_email, '') is null or nullif(v_full_name, '') is null then
    raise exception 'identity migration profile incomplete' using errcode = '22023';
  end if;

  select count(*)::integer into v_email_matches
  from public.profiles where lower(btrim(email)) = v_email;
  if v_email_matches <> 1 then
    raise exception 'identity migration email ambiguous' using errcode = '21000';
  end if;

  if exists (
    select 1 from public.authentication_identity_links
    where provider = 'cognito' and tracepoint_user_id = p_target_user_id
  ) or exists (
    select 1 from public.authentication_lifecycle_operations
    where operation_kind = 'migrate_identity'
      and tracepoint_user_id = p_target_user_id
      and state in ('prepared', 'provider_succeeded', 'compensation_required')
  ) then
    raise exception 'identity migration already exists' using errcode = '23505';
  end if;

  insert into public.authentication_lifecycle_operations(
    id, operation_kind, tracepoint_user_id, department_id, actor_user_id, provider_username, state
  ) values (
    p_operation_id, 'migrate_identity', p_target_user_id, p_department_id, v_actor, p_provider_username, 'prepared'
  );

  insert into public.authentication_identity_events(
    tracepoint_user_id, provider, issuer, provider_username, event_type, actor_user_id, operation_id
  ) values (
    p_target_user_id, 'cognito', 'pending', p_provider_username, 'prepared', v_actor, p_operation_id
  );

  return query select v_email, v_full_name;
end;
$$;

create function tracepoint_auth.commit_existing_cognito_migration(
  p_operation_id uuid,
  p_subject text,
  p_issuer text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_op public.authentication_lifecycle_operations%rowtype;
begin
  if session_user <> 'tracepoint_runtime'
     or nullif(btrim(p_subject), '') is null
     or nullif(btrim(p_issuer), '') is null then
    raise exception 'identity migration commit rejected' using errcode = '42501';
  end if;
  select * into v_op from public.authentication_lifecycle_operations
    where id = p_operation_id and operation_kind = 'migrate_identity' and state = 'prepared'
    for update;
  if not found then raise exception 'identity migration operation unavailable' using errcode = 'P0002'; end if;

  insert into public.authentication_identity_links(provider, issuer, subject, tracepoint_user_id, state, provider_username)
  values ('cognito', p_issuer, p_subject, v_op.tracepoint_user_id, 'pending', v_op.provider_username);
  insert into public.authentication_identity_events(
    tracepoint_user_id, provider, issuer, subject, provider_username, event_type, actor_user_id, operation_id
  ) values (
    v_op.tracepoint_user_id, 'cognito', p_issuer, p_subject, v_op.provider_username, 'linked', v_op.actor_user_id, v_op.id
  );
  update public.authentication_lifecycle_operations
    set provider_subject = p_subject, state = 'provider_succeeded', attempts = attempts + 1, updated_at = now()
    where id = v_op.id;
end;
$$;

create function tracepoint_auth.finish_existing_cognito_migration(
  p_operation_id uuid,
  p_sent boolean,
  p_error_code text default null
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_op public.authentication_lifecycle_operations%rowtype;
begin
  if session_user <> 'tracepoint_runtime' then
    raise exception 'identity migration finish rejected' using errcode = '42501';
  end if;
  select * into v_op from public.authentication_lifecycle_operations
    where id = p_operation_id and operation_kind = 'migrate_identity'
    for update;
  if not found then raise exception 'identity migration operation unavailable' using errcode = 'P0002'; end if;

  if not p_sent then
    update public.authentication_lifecycle_operations
      set state = 'compensation_required', attempts = attempts + 1,
          safe_error_code = left(coalesce(p_error_code, 'activation_delivery_unconfirmed'), 80), updated_at = now()
      where id = v_op.id;
    return;
  end if;

  update public.department_memberships set activation_status = 'activation_sent'
    where department_id = v_op.department_id and user_id = v_op.tracepoint_user_id and is_active;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, new_value)
  values (
    v_op.department_id, v_op.actor_user_id, 'cognito_identity_migration_started', 'department_membership',
    v_op.tracepoint_user_id, 'An existing TracePoint user was enrolled for Cognito activation.',
    jsonb_build_object('identity_provider', 'cognito', 'activation_status', 'activation_sent', 'operation_id', v_op.id)
  );
  update public.authentication_lifecycle_operations
    set state = 'committed', attempts = attempts + 1, safe_error_code = null, updated_at = now()
    where id = v_op.id;
end;
$$;

create function public.record_cognito_activation_delivery(
  p_department_id uuid,
  p_target_user_id uuid,
  p_token_id uuid,
  p_expires_at timestamptz
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_actor uuid := tracepoint_auth.subject_id();
begin
  if session_user <> 'tracepoint_runtime'
     or v_actor is null
     or current_setting('tracepoint.department_id', true) is distinct from p_department_id::text
     or not (public.has_department_permission(p_department_id, 'manage_users')
             or public.has_department_permission(p_department_id, 'administer_department'))
     or not exists (
       select 1 from public.department_memberships member
       join public.authentication_identity_links link
         on link.tracepoint_user_id = member.user_id and link.provider = 'cognito' and link.state = 'pending'
       where member.department_id = p_department_id and member.user_id = p_target_user_id and member.is_active
     ) then
    raise exception 'activation delivery record forbidden' using errcode = '42501';
  end if;

  update public.department_memberships set activation_status = 'activation_sent'
    where department_id = p_department_id and user_id = p_target_user_id and is_active;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, new_value)
  values (
    p_department_id, v_actor, 'activation_email_sent', 'department_membership', p_target_user_id,
    'A Cognito activation email was sent.',
    jsonb_build_object('activation_status', 'activation_sent', 'activation_token_id', p_token_id, 'activation_expires_at', p_expires_at)
  );
end;
$$;

revoke all on function tracepoint_auth.prepare_existing_cognito_migration(uuid, text, uuid, uuid) from public, anon, service_role;
grant execute on function tracepoint_auth.prepare_existing_cognito_migration(uuid, text, uuid, uuid) to authenticated;
revoke all on function tracepoint_auth.commit_existing_cognito_migration(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function tracepoint_auth.commit_existing_cognito_migration(uuid, text, text) to tracepoint_runtime;
revoke all on function tracepoint_auth.finish_existing_cognito_migration(uuid, boolean, text) from public, anon, authenticated, service_role;
grant execute on function tracepoint_auth.finish_existing_cognito_migration(uuid, boolean, text) to tracepoint_runtime;
revoke all on function public.record_cognito_activation_delivery(uuid, uuid, uuid, timestamptz) from public, anon, service_role;
grant execute on function public.record_cognito_activation_delivery(uuid, uuid, uuid, timestamptz) to authenticated;

commit;
