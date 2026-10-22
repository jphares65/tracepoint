begin;

-- D-2: an officer's equipment condition report (Damaged, Missing Parts, Out of
-- Service) on the item they hold, or on available pool equipment, was never
-- stored under the AWS runtime. Members have no direct update right on
-- equipment_assets (052), so the custody route's update matched no row and the
-- officer was told the equipment "was changed before this report could be
-- saved". As with self-custody, the report is a bounded function: it takes the
-- asset out of service, appends the report to its notes and writes the audit
-- event in one transaction. Equipment managers keep their direct update path.
create or replace function public.report_equipment_condition(
  p_department_id uuid,
  p_asset_id uuid,
  p_condition text,
  p_note text,
  p_expected_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_subject uuid := tracepoint_auth.subject_id();
  v_asset public.equipment_assets;
  v_recorded_at timestamptz := now();
  v_notes text;
begin
  if v_subject is null
     or p_department_id is distinct from tracepoint_auth.department_id()
     or not exists (
       select 1 from public.department_memberships membership
       where membership.department_id = p_department_id
         and membership.user_id = v_subject
         and membership.is_active
     )
     or not exists (
       select 1 from public.department_features feature
       where feature.department_id = p_department_id
         and feature.feature_code = 'equipment_readiness'
         and feature.is_enabled is not false
     ) then
    raise exception 'equipment condition report forbidden' using errcode = '42501';
  end if;
  if p_condition not in ('damaged', 'missing_parts', 'out_of_service')
     or length(btrim(coalesce(p_note, ''))) not between 1 and 1000 then
    raise exception 'invalid equipment condition report' using errcode = '22023';
  end if;

  select * into v_asset from public.equipment_assets
  where id = p_asset_id and department_id = p_department_id
  for update;
  -- Changed since the reporter read it (status or notes): nothing is written.
  if not found or v_asset.lifecycle_status <> 'active'
     or v_asset.notes is distinct from p_expected_notes then
    return null;
  end if;
  -- Only the custodian, or anyone for unassigned equipment.
  if v_asset.assigned_user_id is distinct from v_subject
     and (v_asset.assigned_user_id is not null or v_asset.assigned_vehicle_id is not null
          or v_asset.assigned_location is not null) then
    raise exception 'equipment condition report forbidden' using errcode = '42501';
  end if;

  v_notes := concat_ws(E'\n', nullif(v_asset.notes, ''),
    format('[%s][condition=%s][reported_by=%s] %s',
      to_char(v_recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), p_condition, v_subject, btrim(p_note)));
  if length(v_notes) > 15000 then
    raise exception 'equipment notes limit reached' using errcode = '22001';
  end if;

  update public.equipment_assets
  set lifecycle_status = 'out_of_service', notes = v_notes, updated_by = v_subject
  where id = p_asset_id
  returning * into v_asset;

  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, previous_value, new_value)
  values (
    p_department_id, v_subject, 'report', 'equipment_asset', p_asset_id,
    format('Reported equipment %s and removed asset from service.', p_condition),
    jsonb_build_object('equipment_asset_id', p_asset_id, 'lifecycle_status', 'active'),
    jsonb_build_object('equipment_asset_id', p_asset_id, 'condition', p_condition, 'notes', btrim(p_note),
      'lifecycle_status', 'out_of_service', 'recorded_at', v_recorded_at)
  );

  return jsonb_build_object(
    'id', v_asset.id, 'manufacturer', v_asset.manufacturer, 'model', v_asset.model,
    'serial_number', v_asset.serial_number, 'asset_number', v_asset.asset_number,
    'lifecycle_status', v_asset.lifecycle_status, 'assigned_user_id', v_asset.assigned_user_id,
    'assigned_vehicle_id', v_asset.assigned_vehicle_id, 'assigned_location', v_asset.assigned_location,
    'notes', v_asset.notes
  );
end;
$$;

revoke all on function public.report_equipment_condition(uuid,uuid,text,text,text) from public, anon, service_role, tracepoint_runtime;
grant execute on function public.report_equipment_condition(uuid,uuid,text,text,text) to authenticated;

commit;
