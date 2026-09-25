begin;

-- In email-sign-in pools Cognito generates the immutable Username (equal to
-- sub). The requested placeholder UUID must not be stored as provider_username.
create function tracepoint_auth.confirm_cognito_provider_username(
  p_operation_id uuid,
  p_requested_username text,
  p_actual_username text,
  p_subject text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_op public.authentication_lifecycle_operations%rowtype;
begin
  if session_user <> 'tracepoint_runtime'
    or p_operation_id is null
    or nullif(btrim(p_requested_username), '') is null
    or p_actual_username is null
    or p_subject is null
    or p_actual_username is distinct from p_subject
    or p_actual_username !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    raise exception 'provider identity reconciliation rejected' using errcode = '42501';
  end if;

  select * into v_op
  from public.authentication_lifecycle_operations
  where id = p_operation_id
    and operation_kind in ('invite', 'migrate_identity')
    and state = 'prepared'
    and provider_username = p_requested_username
  for update;
  if not found then
    raise exception 'provider identity operation unavailable' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.authentication_identity_links
    where provider = 'cognito' and (subject = p_subject or provider_username = p_actual_username)
      and not (tracepoint_user_id = v_op.tracepoint_user_id
        and subject = p_subject
        and provider_username = p_actual_username
        and state = 'pending')
  ) then
    raise exception 'provider identity collision' using errcode = '23505';
  end if;

  update public.authentication_lifecycle_operations
  set provider_username = p_actual_username, updated_at = now()
  where id = p_operation_id;
end;
$$;

revoke all on function tracepoint_auth.confirm_cognito_provider_username(uuid,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function tracepoint_auth.confirm_cognito_provider_username(uuid,text,text,text)
  to tracepoint_runtime;

-- A pending AWS-native identity receives Cognito's temporary-password invitation,
-- never a Supabase activation token. Both calls are tenant/actor scoped.
create function tracepoint_auth.prepare_cognito_activation_resend(
  p_department_id uuid, p_user_id uuid
) returns table(email text, provider_subject text, issuer text)
language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if session_user <> 'tracepoint_runtime'
    or tracepoint_auth.subject_id() is null
    or current_setting('tracepoint.department_id', true) is distinct from p_department_id::text
    or not (public.has_department_permission(p_department_id, 'manage_users')
      or public.has_department_permission(p_department_id, 'administer_department'))
  then raise exception 'activation resend forbidden' using errcode = '42501'; end if;
  return query
    select p.email::text, l.subject::text, l.issuer::text
    from public.department_memberships m
    join public.profiles p on p.id = m.user_id
    join public.authentication_identity_links l on l.tracepoint_user_id = m.user_id
    where m.department_id = p_department_id and m.user_id = p_user_id and m.is_active
      and m.activation_status in ('pending_activation', 'activation_sent')
      and l.provider = 'cognito' and l.state = 'pending'
      and l.provider_username = l.subject;
  if not found then raise exception 'pending activation unavailable' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function tracepoint_auth.prepare_cognito_activation_resend(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function tracepoint_auth.prepare_cognito_activation_resend(uuid,uuid)
  to tracepoint_runtime;

create function tracepoint_auth.finish_cognito_activation_resend(
  p_department_id uuid, p_user_id uuid, p_subject text
) returns void
language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if session_user <> 'tracepoint_runtime'
    or tracepoint_auth.subject_id() is null
    or current_setting('tracepoint.department_id', true) is distinct from p_department_id::text
    or not (public.has_department_permission(p_department_id, 'manage_users')
      or public.has_department_permission(p_department_id, 'administer_department'))
    or not exists (
      select 1 from public.department_memberships m
      join public.authentication_identity_links l on l.tracepoint_user_id = m.user_id
      where m.department_id = p_department_id and m.user_id = p_user_id and m.is_active
        and l.provider = 'cognito' and l.state = 'pending'
        and l.subject = p_subject and l.provider_username = p_subject)
  then raise exception 'activation resend forbidden' using errcode = '42501'; end if;
  update public.department_memberships set activation_status = 'activation_sent'
    where department_id = p_department_id and user_id = p_user_id and is_active;
  insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,summary,new_value)
    values(p_department_id,tracepoint_auth.subject_id(),'cognito_activation_invitation_resent',
      'department_membership',p_user_id,'A pending Cognito invitation was re-sent.',
      jsonb_build_object('identity_provider','cognito','activation_status','activation_sent'));
end;
$$;
revoke all on function tracepoint_auth.finish_cognito_activation_resend(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function tracepoint_auth.finish_cognito_activation_resend(uuid,uuid,text)
  to tracepoint_runtime;

commit;
