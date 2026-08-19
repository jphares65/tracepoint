-- Keep equipment_assets.assigned_user_id as the fast "current custodian"
-- while automatically maintaining immutable custody history.

create or replace function public.normalize_equipment_asset_assignment()
returns trigger
language plpgsql
as $$
begin
    -- A removed asset cannot remain actively assigned.
    if new.lifecycle_status = 'removed' then
        new.assigned_user_id := null;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_equipment_asset_normalize_assignment
    on public.equipment_assets;

create trigger trg_equipment_asset_normalize_assignment
before insert or update of assigned_user_id, lifecycle_status
on public.equipment_assets
for each row
execute function public.normalize_equipment_asset_assignment();


create or replace function public.sync_equipment_asset_assignment_history()
returns trigger
language plpgsql
as $$
begin
    -- New asset created already assigned to an officer.
    if tg_op = 'INSERT' then
        if new.assigned_user_id is not null then
            insert into public.equipment_asset_assignments (
                department_id,
                equipment_asset_id,
                assigned_user_id,
                assigned_at,
                assigned_by,
                assignment_notes
            )
            values (
                new.department_id,
                new.id,
                new.assigned_user_id,
                coalesce(new.issue_date::timestamptz, now()),
                coalesce(new.created_by, new.updated_by),
                'Equipment issued at asset creation'
            )
            on conflict do nothing;
        end if;

        return new;
    end if;

    -- Nothing to do if custody did not change.
    if old.assigned_user_id is not distinct from new.assigned_user_id then
        return new;
    end if;

    -- Close the prior active custody record.
    if old.assigned_user_id is not null then
        update public.equipment_asset_assignments
        set
            returned_at = now(),
            returned_by = new.updated_by,
            return_notes =
                case
                    when new.lifecycle_status = 'removed'
                        then 'Equipment removed from active inventory'
                    when new.assigned_user_id is null
                        then 'Equipment returned / unassigned'
                    else
                        'Equipment reassigned'
                end
        where equipment_asset_id = new.id
          and department_id = new.department_id
          and returned_at is null;
    end if;

    -- Open the new custody record.
    if new.assigned_user_id is not null then
        insert into public.equipment_asset_assignments (
            department_id,
            equipment_asset_id,
            assigned_user_id,
            assigned_at,
            assigned_by,
            assignment_notes
        )
        values (
            new.department_id,
            new.id,
            new.assigned_user_id,
            now(),
            new.updated_by,
            case
                when old.assigned_user_id is null
                    then 'Equipment issued'
                else
                    'Equipment reassigned'
            end
        );
    end if;

    return new;
end;
$$;

drop trigger if exists trg_equipment_asset_assignment_history
    on public.equipment_assets;

create trigger trg_equipment_asset_assignment_history
after insert or update of assigned_user_id
on public.equipment_assets
for each row
execute function public.sync_equipment_asset_assignment_history();
