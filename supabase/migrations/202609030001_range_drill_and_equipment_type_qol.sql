begin;

-- Normalize names before constraints and keep uniqueness tenant-local.
update public.equipment_types set name = btrim(name), category = btrim(category);

create unique index if not exists equipment_types_department_normalized_name_unique
  on public.equipment_types (department_id, lower(btrim(name)));

create or replace function public.normalize_equipment_type_name()
returns trigger language plpgsql set search_path = public as $$
begin
  new.name := btrim(new.name);
  new.category := coalesce(nullif(btrim(new.category), ''), 'General');
  if new.name = '' then
    raise exception using errcode = '23514', message = 'Equipment type name is required.';
  end if;
  if tg_op = 'UPDATE' and new.department_id is distinct from old.department_id then
    raise exception using errcode = '23514', message = 'Equipment type agency ownership cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists equipment_types_normalize_name on public.equipment_types;
create trigger equipment_types_normalize_name
before insert or update of name, category, department_id on public.equipment_types
for each row execute function public.normalize_equipment_type_name();

-- Relational range-day drills receive the same immutable-history protection as
-- the workspace API. Existing FK restrictions continue to protect results.
create or replace function public.protect_range_day_drill_history()
returns trigger language plpgsql set search_path = public as $$
declare parent_status text; parent_packet_status text;
begin
  select status::text, packet_status::text into parent_status, parent_packet_status
  from public.range_days
  where id = old.range_day_id and department_id = old.department_id;

  if lower(coalesce(parent_status, '')) in ('completed', 'locked', 'archived')
     or lower(coalesce(parent_packet_status, '')) = 'ready' then
    raise exception using errcode = '23514',
      message = 'The drill cannot be removed because the range day or packet is finalized or locked.';
  end if;
  return old;
end;
$$;

drop trigger if exists range_day_drills_protect_history on public.range_day_drills;
create trigger range_day_drills_protect_history
before delete on public.range_day_drills
for each row execute function public.protect_range_day_drill_history();

drop policy if exists "range_day_drills_delete_managers" on public.range_day_drills;
create policy "range_day_drills_delete_managers"
on public.range_day_drills for delete to authenticated
using (public.has_department_permission(department_id, 'manage_range_days'));

-- Retain the assigned-equipment RLS behavior: officers can read their own
-- assignment history; agency equipment managers can read all agency history.
drop policy if exists "equipment_assignment_history_select_scoped" on public.equipment_asset_assignments;
create policy "equipment_assignment_history_select_scoped"
on public.equipment_asset_assignments for select to authenticated
using (
  public.is_active_department_member(department_id, auth.uid())
  and (
    assigned_user_id = auth.uid()
    or public.has_any_department_permission(
      department_id, array['manage_equipment', 'administer_department']
    )
  )
);

commit;
