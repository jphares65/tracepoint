begin;

-- A failed provider-create leaves one application identity and one invite
-- lifecycle operation. Read-only inspection and an atomic claim allow the
-- same invitation to resume without creating another application identity.
create function tracepoint_auth.inspect_cognito_invite_retry(
  p_department_id uuid, p_email text, p_full_name text,
  p_badge_number text, p_rank_title text, p_unit_name text,
  p_employee_number text, p_role_codes text[], p_group_ids uuid[]
) returns table(user_id uuid, operation_id uuid, provider_username text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user_id uuid;
  v_op public.authentication_lifecycle_operations%rowtype;
  v_email text := lower(btrim(p_email));
begin
  if session_user <> 'tracepoint_runtime'
     or tracepoint_auth.subject_id() is null
     or current_setting('tracepoint.department_id', true) is distinct from p_department_id::text
     or not (public.has_department_permission(p_department_id, 'manage_users')
             or public.has_department_permission(p_department_id, 'administer_department')) then
    raise exception 'invite retry forbidden' using errcode = '42501';
  end if;
  if v_email is null or v_email = '' or nullif(btrim(p_full_name), '') is null
     or coalesce(cardinality(p_role_codes), 0) = 0 then
    raise exception 'invite retry invalid' using errcode = '22023';
  end if;
  if 'administrator' = any(p_role_codes)
     and not public.has_department_permission(p_department_id, 'administer_department') then
    raise exception 'administrator assignment forbidden' using errcode = '42501';
  end if;

  if (select count(*) from public.profiles where lower(btrim(email)) = v_email) = 0 then
    if (select count(*) from auth.users where lower(btrim(email)) = v_email) <> 0 then
      raise exception 'invite retry identity ambiguous' using errcode = '21000';
    end if;
    return;
  end if;
  if (select count(*) from public.profiles where lower(btrim(email)) = v_email) <> 1
     or (select count(*) from auth.users where lower(btrim(email)) = v_email) <> 1 then
    raise exception 'invite retry identity ambiguous' using errcode = '21000';
  end if;
  select p.id into v_user_id from public.profiles p
    where lower(btrim(p.email)) = v_email;
  if not exists (
      select 1 from public.profiles p join auth.users a on a.id = p.id
      where p.id = v_user_id and p.full_name = btrim(p_full_name)
        and lower(btrim(a.email)) = v_email
        and a.raw_user_meta_data->>'identity_provider' = 'cognito'
    )
    or (select count(*) from public.department_memberships m where m.user_id = v_user_id) <> 1
    or not exists (
      select 1 from public.department_memberships m
      where m.user_id = v_user_id and m.department_id = p_department_id
        and m.is_active and m.deactivated_at is null
        and m.activation_status = 'pending_activation'
        and m.badge_number is not distinct from nullif(btrim(p_badge_number), '')
        and m.rank_title is not distinct from nullif(btrim(p_rank_title), '')
        and m.unit_name is not distinct from nullif(btrim(p_unit_name), '')
        and m.employee_number is not distinct from nullif(btrim(p_employee_number), '')
    )
    or (select array_agg(r.role_code order by r.role_code)
        from public.department_membership_roles r
        where r.user_id = v_user_id and r.department_id = p_department_id)
       is distinct from
       (select array_agg(code order by code) from unnest(p_role_codes) code)
    or (select array_agg(g.group_id order by g.group_id)
        from public.department_group_members g
        where g.user_id = v_user_id and g.department_id = p_department_id)
       is distinct from
       (select array_agg(id order by id) from unnest(coalesce(p_group_ids, array[]::uuid[])) id)
    or exists (select 1 from public.authentication_identity_links l where l.tracepoint_user_id = v_user_id)
    or exists (select 1 from public.user_activation_tokens t where t.user_id = v_user_id)
    or exists (select 1 from public.authentication_identity_events e where e.tracepoint_user_id = v_user_id)
  then
    raise exception 'invite retry identity mismatch' using errcode = '42501';
  end if;

  if (select count(*) from public.authentication_lifecycle_operations o
      where o.tracepoint_user_id = v_user_id) <> 1 then
    raise exception 'invite retry lifecycle ambiguous' using errcode = '21000';
  end if;
  select * into v_op from public.authentication_lifecycle_operations o
    where o.tracepoint_user_id = v_user_id;
  if v_op.operation_kind is distinct from 'invite' or v_op.department_id is distinct from p_department_id
     or v_op.actor_user_id is distinct from tracepoint_auth.subject_id()
     or v_op.state is distinct from 'compensation_required'
     or v_op.safe_error_code is distinct from 'provider_create_failed'
     or v_op.provider_subject is not null
     or v_op.provider_username is null
     or v_op.provider_username !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_op.attempts >= 100 then
    raise exception 'invite retry lifecycle mismatch' using errcode = '42501';
  end if;
  return query select v_user_id, v_op.id, v_op.provider_username;
end;
$$;

create function tracepoint_auth.claim_cognito_invite_retry(
  p_department_id uuid, p_email text, p_full_name text,
  p_badge_number text, p_rank_title text, p_unit_name text,
  p_employee_number text, p_role_codes text[], p_group_ids uuid[],
  p_operation_id uuid
) returns table(user_id uuid, operation_id uuid, provider_username text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_user_id uuid; v_operation_id uuid; v_provider_username text;
begin
  perform 1 from public.authentication_lifecycle_operations o
    where o.id = p_operation_id for update;
  select i.user_id, i.operation_id, i.provider_username
    into v_user_id, v_operation_id, v_provider_username
  from tracepoint_auth.inspect_cognito_invite_retry(
    p_department_id, p_email, p_full_name, p_badge_number, p_rank_title,
    p_unit_name, p_employee_number, p_role_codes, p_group_ids
  ) i;
  if v_operation_id is distinct from p_operation_id then
    raise exception 'invite retry claim mismatch' using errcode = '42501';
  end if;
  update public.authentication_lifecycle_operations o
    set state = 'prepared', safe_error_code = null, attempts = attempts + 1,
        updated_at = now()
    where o.id = p_operation_id and o.state = 'compensation_required'
      and o.safe_error_code = 'provider_create_failed';
  if not found then raise exception 'invite retry claim lost' using errcode = '40001'; end if;
  return query select v_user_id, v_operation_id, v_provider_username;
end;
$$;

revoke all on function tracepoint_auth.inspect_cognito_invite_retry(uuid,text,text,text,text,text,text,text[],uuid[])
  from public, anon, service_role;
revoke all on function tracepoint_auth.claim_cognito_invite_retry(uuid,text,text,text,text,text,text,text[],uuid[],uuid)
  from public, anon, service_role;
grant execute on function tracepoint_auth.inspect_cognito_invite_retry(uuid,text,text,text,text,text,text,text[],uuid[])
  to authenticated;
grant execute on function tracepoint_auth.claim_cognito_invite_retry(uuid,text,text,text,text,text,text,text[],uuid[],uuid)
  to authenticated;

commit;
