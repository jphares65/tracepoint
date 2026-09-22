begin;

create policy off_duty_requests_insert_onboarding_manager
on public.off_duty_firearm_requests
for insert
to authenticated
with check (
  (
    public.has_department_permission(department_id, 'review_off_duty_requests')
    or public.has_department_permission(department_id, 'manage_firearms')
    or public.has_department_permission(department_id, 'administer_department')
  )
  and exists (
    select 1 from public.department_memberships member
    where member.department_id = off_duty_firearm_requests.department_id
      and member.user_id = off_duty_firearm_requests.officer_user_id
      and member.is_active
  )
);

create policy qualification_results_historical_import_range_manager
on public.qualification_results
for insert
to authenticated
with check (
  record_origin = 'historical_import'
  and (
    public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  )
  and exists (
    select 1 from public.department_memberships member
    where member.department_id = qualification_results.department_id
      and member.user_id = qualification_results.officer_user_id
      and member.is_active
  )
);

create policy qualification_results_historical_update_range_manager
on public.qualification_results
for update
to authenticated
using (
  record_origin = 'historical_import'
  and (
    public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  )
)
with check (
  record_origin = 'historical_import'
  and (
    public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  )
);

create or replace function public.record_onboarding_import_audit(
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

  case
    when p_action = 'equipment_imported_during_onboarding'
         and p_entity_type = 'equipment_asset' then
      v_authorized := public.has_department_permission(p_department_id, 'manage_equipment')
        or public.has_department_permission(p_department_id, 'administer_department');
      select exists(select 1 from public.equipment_assets where id = p_entity_id and department_id = p_department_id)
        into v_entity_exists;
    when p_action = 'certification_imported_during_onboarding'
         and p_entity_type = 'training_certification' then
      v_authorized := public.has_department_permission(p_department_id, 'manage_certifications')
        or public.has_department_permission(p_department_id, 'administer_department');
      select exists(select 1 from public.training_certifications where id = p_entity_id and department_id = p_department_id)
        into v_entity_exists;
    when p_action in (
           'firearm_assignment_added_during_onboarding',
           'firearm_enriched_during_onboarding',
           'firearm_imported_during_onboarding'
         ) and p_entity_type = 'firearm' then
      v_authorized := public.has_department_permission(p_department_id, 'manage_firearms')
        or public.has_department_permission(p_department_id, 'administer_department');
      select exists(select 1 from public.firearms where id = p_entity_id and department_id = p_department_id)
        into v_entity_exists;
    when p_action = 'off_duty_firearm_imported_during_onboarding'
         and p_entity_type = 'off_duty_firearm_request' then
      v_authorized := public.has_department_permission(p_department_id, 'review_off_duty_requests')
        or public.has_department_permission(p_department_id, 'manage_firearms')
        or public.has_department_permission(p_department_id, 'administer_department');
      select exists(select 1 from public.off_duty_firearm_requests where id = p_entity_id and department_id = p_department_id)
        into v_entity_exists;
    when p_action = 'historical_qualification_imported'
         and p_entity_type = 'qualification_result' then
      v_authorized := public.has_department_permission(p_department_id, 'manage_qualifications')
        or public.has_department_permission(p_department_id, 'manage_range_days')
        or public.has_department_permission(p_department_id, 'administer_department');
      select exists(select 1 from public.qualification_results where id = p_entity_id and department_id = p_department_id)
        into v_entity_exists;
    else
      raise exception 'unsupported onboarding audit event' using errcode = '22023';
  end case;

  if not v_authorized or not v_entity_exists then
    raise exception 'onboarding audit forbidden' using errcode = '42501';
  end if;

  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, new_value)
  values (p_department_id, v_actor, p_action, p_entity_type, p_entity_id, coalesce(p_new_value, '{}'::jsonb));
end;
$$;

commit;
