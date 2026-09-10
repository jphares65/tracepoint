begin;

create function public.get_platform_entitlements()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_departments jsonb;
  v_features jsonb;
  v_entitlements jsonb;
begin
  if session_user <> 'tracepoint_runtime'
     or tracepoint_auth.subject_id() is null
     or not public.is_platform_admin() then
    raise exception 'platform administrator access required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'short_name', short_name) order by name), '[]'::jsonb)
    into v_departments from public.departments;
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'display_name', display_name, 'description', description, 'sort_order', sort_order, 'is_active', is_active) order by sort_order, code), '[]'::jsonb)
    into v_features from public.feature_catalog where is_active;
  select coalesce(jsonb_agg(jsonb_build_object(
      'department_id', department_id, 'feature_code', feature_code, 'is_enabled', is_enabled,
      'enabled_at', enabled_at, 'disabled_at', disabled_at, 'updated_at', updated_at, 'updated_by', updated_by
    ) order by department_id, feature_code), '[]'::jsonb)
    into v_entitlements from public.department_features;
  return jsonb_build_object('departments', v_departments, 'features', v_features, 'entitlements', v_entitlements);
end;
$$;

create function public.set_platform_entitlement(
  p_department_id uuid,
  p_feature_code text,
  p_is_enabled boolean,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := tracepoint_auth.subject_id();
  v_previous boolean;
begin
  if session_user <> 'tracepoint_runtime' or v_actor is null or not public.is_platform_admin() then
    raise exception 'platform administrator access required' using errcode = '42501';
  end if;
  if not exists(select 1 from public.departments where id = p_department_id) then
    raise exception 'department unavailable' using errcode = 'P0002';
  end if;
  if not exists(select 1 from public.feature_catalog where code = p_feature_code and is_active) then
    raise exception 'feature unavailable' using errcode = 'P0002';
  end if;
  select is_enabled into v_previous from public.department_features
    where department_id = p_department_id and feature_code = p_feature_code for update;
  v_previous := coalesce(v_previous, true);

  insert into public.department_features(
    department_id, feature_code, is_enabled, enabled_at, disabled_at, updated_at, updated_by
  ) values (
    p_department_id, p_feature_code, p_is_enabled,
    case when p_is_enabled then now() else null end,
    case when p_is_enabled then null else now() end,
    now(), v_actor
  ) on conflict(department_id, feature_code) do update set
    is_enabled = excluded.is_enabled,
    enabled_at = excluded.enabled_at,
    disabled_at = excluded.disabled_at,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  if v_previous is distinct from p_is_enabled then
    insert into public.department_feature_events(
      department_id, feature_code, previous_enabled, new_enabled, actor_user_id, reason
    ) values (
      p_department_id, p_feature_code, v_previous, p_is_enabled, v_actor, nullif(btrim(p_reason), '')
    );
  end if;
end;
$$;

revoke all on function public.get_platform_entitlements() from public, anon, service_role;
grant execute on function public.get_platform_entitlements() to authenticated;
revoke all on function public.set_platform_entitlement(uuid, text, boolean, text) from public, anon, service_role;
grant execute on function public.set_platform_entitlement(uuid, text, boolean, text) to authenticated;

commit;
