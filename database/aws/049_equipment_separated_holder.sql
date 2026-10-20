begin;

-- Equipment held by a separated (inactive) member (EQP-01, EQP-04, EQP-12).

-- 1. The custody guard rejected any update that listed assigned_user_id or
-- assigned_vehicle_id while the holder was inactive or the vehicle Retired, so
-- an item they still held could not be marked out of service. Only a NEW
-- holder must be an active member (or a vehicle in service); returning,
-- removing or changing the status of an item they hold is allowed.
create or replace function public.validate_equipment_asset_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if tg_op = 'UPDATE' and new.department_id is distinct from old.department_id then
    raise exception using
      errcode = '23514',
      message = 'Equipment agency ownership cannot be changed.';
  end if;

  if new.assigned_user_id is not null
     and (tg_op = 'INSERT' or new.assigned_user_id is distinct from old.assigned_user_id)
     and not exists (
    select 1 from public.department_memberships member
    where member.department_id = new.department_id
      and member.user_id = new.assigned_user_id
      and member.is_active = true
  ) then
    raise exception using
      errcode = '23514',
      message = 'Assigned officer must be an active member of the equipment agency.';
  end if;

  if new.assigned_vehicle_id is not null
     and (tg_op = 'INSERT' or new.assigned_vehicle_id is distinct from old.assigned_vehicle_id)
     and not exists (
    select 1 from public.fleet_vehicles vehicle
    where vehicle.department_id = new.department_id
      and vehicle.id = new.assigned_vehicle_id
      and vehicle.status <> 'Retired'
  ) then
    raise exception using
      errcode = '23514',
      message = 'Assigned vehicle must belong to the equipment agency.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_equipment_asset_assignment() from public;
grant execute on function public.validate_equipment_asset_assignment() to authenticated;

-- 2. Closing an assignment on removal records the removal reason in the
-- custody history note. Otherwise unchanged from 202608190002.
create or replace function public.sync_equipment_asset_assignment_history()
returns trigger
language plpgsql
as $$
begin
    if tg_op = 'INSERT' then
        if new.assigned_user_id is not null then
            insert into public.equipment_asset_assignments (
                department_id, equipment_asset_id, assigned_user_id,
                assigned_at, assigned_by, assignment_notes
            )
            values (
                new.department_id, new.id, new.assigned_user_id,
                coalesce(new.issue_date::timestamptz, now()),
                coalesce(new.created_by, new.updated_by),
                'Equipment issued at asset creation'
            )
            on conflict do nothing;
        end if;

        return new;
    end if;

    if old.assigned_user_id is not distinct from new.assigned_user_id then
        return new;
    end if;

    if old.assigned_user_id is not null then
        update public.equipment_asset_assignments
        set
            returned_at = now(),
            returned_by = new.updated_by,
            return_notes =
                case
                    when new.lifecycle_status = 'removed'
                        then 'Equipment removed from active inventory'
                             || coalesce(': ' || nullif(btrim(new.removal_reason), ''), '')
                    when new.assigned_user_id is null
                        then 'Equipment returned / unassigned'
                    else
                        'Equipment reassigned'
                end
        where equipment_asset_id = new.id
          and department_id = new.department_id
          and returned_at is null;
    end if;

    if new.assigned_user_id is not null then
        insert into public.equipment_asset_assignments (
            department_id, equipment_asset_id, assigned_user_id,
            assigned_at, assigned_by, assignment_notes
        )
        values (
            new.department_id, new.id, new.assigned_user_id, now(), new.updated_by,
            case when old.assigned_user_id is null then 'Equipment issued' else 'Equipment reassigned' end
        );
    end if;

    return new;
end;
$$;

-- 3. Equipment managers and user administrators can read the names of members
-- of their agency only while the membership is active, so a separated
-- holder's name disappeared. The membership row itself stays readable to the
-- same roles (department_memberships_select_self_or_admin); the profile now
-- follows it. Same permission list, same agency scoping.
drop policy if exists "profiles_select_self_or_department_admin" on public.profiles;
create policy "profiles_select_self_or_department_admin"
on public.profiles
for select
to authenticated
using (
  id = tracepoint_auth.subject_id()
  or exists (
    select 1
    from public.department_memberships target_membership
    where target_membership.user_id = profiles.id
      and public.has_any_department_permission(
        target_membership.department_id,
        array['manage_users', 'manage_equipment', 'administer_department']
      )
  )
);

commit;
