begin;

create function tracepoint_auth.is_platform_supporting(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select session_user = 'tracepoint_runtime'
    and coalesce(nullif(current_setting('tracepoint.support_department_id', true), '')::uuid = p_department_id, false)
    and exists (
      select 1 from public.platform_admins
      where user_id = tracepoint_auth.subject_id() and is_active
    )
    and exists (
      select 1 from public.departments where id = p_department_id and is_active
    )
$$;

create or replace function public.is_department_member(p_department_id uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$
  select tracepoint_auth.is_platform_supporting(p_department_id) or exists (
    select 1 from public.department_memberships membership
    where membership.department_id = p_department_id
      and membership.user_id = tracepoint_auth.subject_id()
      and membership.is_active
  )
$$;

create or replace function public.is_active_department_member(p_department_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$
  select (p_user_id = tracepoint_auth.subject_id() and tracepoint_auth.is_platform_supporting(p_department_id)) or exists (
    select 1 from public.department_memberships membership
    where membership.department_id = p_department_id
      and membership.user_id = p_user_id
      and membership.is_active
  )
$$;

create or replace function public.has_department_permission(p_department_id uuid, p_permission_code text)
returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$
  select (
    tracepoint_auth.is_platform_supporting(p_department_id)
    and exists (select 1 from public.permissions permission where permission.code = p_permission_code)
  ) or exists (
    select 1
    from public.department_memberships membership
    join public.department_membership_roles membership_role
      on membership_role.department_id = membership.department_id and membership_role.user_id = membership.user_id
    where membership.department_id = p_department_id
      and membership.user_id = tracepoint_auth.subject_id()
      and membership.is_active
      and exists (select 1 from public.permissions permission where permission.code = p_permission_code)
      and (
        membership_role.role_code = 'administrator'
        or exists (
          select 1 from public.department_role_permissions role_permission
          where role_permission.department_id = membership_role.department_id
            and role_permission.role_code = membership_role.role_code
            and role_permission.permission_code = p_permission_code
        )
      )
  )
$$;

create function public.platform_support_context(p_department_id uuid)
returns table(
  id uuid, name text, short_name text, patch_url text, accent_color text,
  login_theme text, enabled_features text[]
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if session_user <> 'tracepoint_runtime' or not public.is_platform_admin() then
    raise exception 'platform support forbidden' using errcode = '42501';
  end if;
  return query
  select department.id, department.name, department.short_name, department.patch_url,
         department.accent_color, department.login_theme,
         coalesce(array_agg(feature.feature_code order by feature.feature_code)
           filter (where feature.feature_code is not null and feature.is_enabled is not false), array[]::text[])
  from public.departments department
  left join public.department_features feature on feature.department_id = department.id
  where department.id = p_department_id and department.is_active
  group by department.id;
end
$$;

create function public.record_platform_support_mode(p_department_id uuid, p_action text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_name text;
begin
  if session_user <> 'tracepoint_runtime'
     or not public.is_platform_admin()
     or p_action not in ('support_mode_entered', 'support_mode_exited') then
    raise exception 'platform support audit forbidden' using errcode = '42501';
  end if;
  select name into v_name from public.departments where id = p_department_id and is_active;
  if not found then raise exception 'platform support department unavailable' using errcode = 'P0002'; end if;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, new_value)
  values (
    p_department_id, tracepoint_auth.subject_id(), p_action, 'department', p_department_id,
    case p_action when 'support_mode_entered' then 'A platform administrator entered Support Mode.' else 'A platform administrator exited Support Mode.' end,
    jsonb_build_object('source', 'platform_support_mode', 'support_mode', true, 'target_department_id', p_department_id, 'target_department_name', v_name)
  );
  return v_name;
end
$$;

revoke all on function tracepoint_auth.is_platform_supporting(uuid) from public, anon, service_role;
grant execute on function tracepoint_auth.is_platform_supporting(uuid) to authenticated;
revoke all on function public.platform_support_context(uuid) from public, anon, service_role;
grant execute on function public.platform_support_context(uuid) to authenticated;
revoke all on function public.record_platform_support_mode(uuid, text) from public, anon, service_role;
grant execute on function public.record_platform_support_mode(uuid, text) to authenticated;

commit;
