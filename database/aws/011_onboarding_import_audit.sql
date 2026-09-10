begin;

create function public.record_onboarding_import_audit(
  p_department_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_new_value jsonb
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := tracepoint_auth.subject_id();
  v_authorized boolean := false;
  v_entity_exists boolean := false;
begin
  if session_user <> 'tracepoint_runtime'
     or v_actor is null
     or current_setting('tracepoint.department_id', true) is distinct from p_department_id::text
     or p_entity_id is null then
    raise exception 'onboarding audit rejected' using errcode = '42501';
  end if;

  if p_action = 'equipment_imported_during_onboarding'
     and p_entity_type = 'equipment_asset' then
    v_authorized := public.has_department_permission(p_department_id, 'manage_equipment')
      or public.has_department_permission(p_department_id, 'administer_department');
    select exists(
      select 1 from public.equipment_assets
      where id = p_entity_id and department_id = p_department_id
    ) into v_entity_exists;
  elsif p_action = 'certification_imported_during_onboarding'
        and p_entity_type = 'training_certification' then
    v_authorized := public.has_department_permission(p_department_id, 'manage_certifications')
      or public.has_department_permission(p_department_id, 'administer_department');
    select exists(
      select 1 from public.training_certifications
      where id = p_entity_id and department_id = p_department_id
    ) into v_entity_exists;
  else
    raise exception 'unsupported onboarding audit event' using errcode = '22023';
  end if;

  if not v_authorized or not v_entity_exists then
    raise exception 'onboarding audit forbidden' using errcode = '42501';
  end if;

  insert into public.audit_events(
    department_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    new_value
  ) values (
    p_department_id,
    v_actor,
    p_action,
    p_entity_type,
    p_entity_id,
    coalesce(p_new_value, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.record_onboarding_import_audit(uuid, text, text, uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.record_onboarding_import_audit(uuid, text, text, uuid, jsonb)
  to authenticated;

commit;
