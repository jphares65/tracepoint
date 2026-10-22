begin;

-- Self-service equipment custody (EQP-06). The custody route lets any active
-- member of an agency with Equipment Readiness enabled check out available
-- active equipment to themselves and check in equipment they hold. Under the
-- AWS runtime the subject could neither see available equipment nor update it.

-- Members may see available equipment so the custody lookup can find it.
drop policy if exists equipment_assets_select_custody_pool on public.equipment_assets;
create policy equipment_assets_select_custody_pool
on public.equipment_assets for select to authenticated
using (
  department_id = tracepoint_auth.department_id()
  and lifecycle_status = 'active'
  and assigned_user_id is null
  and assigned_vehicle_id is null
  and assigned_location is null
  and public.is_active_department_member(department_id, tracepoint_auth.subject_id())
  and exists (
    select 1 from public.department_features feature
    where feature.department_id = equipment_assets.department_id
      and feature.feature_code = 'equipment_readiness'
      and feature.is_enabled is not false
  )
);

-- The transfer itself stays a bounded function: no direct asset or history
-- update rights are granted to members.
create or replace function public.operate_equipment_self_custody(
  p_department_id uuid,
  p_asset_id uuid,
  p_action text,
  p_condition text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_subject uuid := tracepoint_auth.subject_id();
  v_asset public.equipment_assets;
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
    raise exception 'equipment custody forbidden' using errcode = '42501';
  end if;
  if p_action not in ('check-out', 'check-in')
     or p_condition not in ('serviceable', 'damaged', 'missing_parts', 'out_of_service')
     or (p_action = 'check-out' and p_condition <> 'serviceable') then
    raise exception 'invalid equipment custody action' using errcode = '22023';
  end if;

  select * into v_asset from public.equipment_assets
  where id = p_asset_id and department_id = p_department_id
  for update;
  if not found or v_asset.lifecycle_status <> 'active' then
    return null;
  end if;

  if p_action = 'check-out' then
    if v_asset.assigned_user_id is not null or v_asset.assigned_vehicle_id is not null
       or v_asset.assigned_location is not null then
      return null;
    end if;
    update public.equipment_assets
    set assigned_user_id = v_subject, updated_by = v_subject
    where id = p_asset_id
    returning * into v_asset;
    update public.equipment_asset_assignments
    set assignment_notes = left(p_note, 1100)
    where department_id = p_department_id and equipment_asset_id = p_asset_id
      and assigned_user_id = v_subject and returned_at is null;
  else
    if v_asset.assigned_user_id is distinct from v_subject then
      return null;
    end if;
    update public.equipment_assets
    set assigned_user_id = null,
        lifecycle_status = case when p_condition = 'serviceable' then 'active' else 'out_of_service' end,
        updated_by = v_subject
    where id = p_asset_id
    returning * into v_asset;
    update public.equipment_asset_assignments
    set return_notes = left(p_note, 1100)
    where id = (
      select assignment.id from public.equipment_asset_assignments assignment
      where assignment.department_id = p_department_id and assignment.equipment_asset_id = p_asset_id
        and assignment.assigned_user_id = v_subject and assignment.returned_at is not null
      order by assignment.returned_at desc
      limit 1
    );
  end if;

  return jsonb_build_object(
    'id', v_asset.id, 'manufacturer', v_asset.manufacturer, 'model', v_asset.model,
    'serial_number', v_asset.serial_number, 'asset_number', v_asset.asset_number,
    'lifecycle_status', v_asset.lifecycle_status, 'assigned_user_id', v_asset.assigned_user_id,
    'assigned_vehicle_id', v_asset.assigned_vehicle_id, 'assigned_location', v_asset.assigned_location
  );
end;
$$;

revoke all on function public.operate_equipment_self_custody(uuid,uuid,text,text,text) from public, anon, service_role, tracepoint_runtime;
grant execute on function public.operate_equipment_self_custody(uuid,uuid,text,text,text) to authenticated;

commit;
