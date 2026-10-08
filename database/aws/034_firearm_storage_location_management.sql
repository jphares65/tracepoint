begin;

-- Keep historic custody references intact while ensuring each agency has one
-- active spelling of a secure-storage location.
update public.firearm_storage_locations duplicate
set is_active = false, updated_at = now()
where duplicate.is_active
  and exists (
    select 1 from public.firearm_storage_locations canonical
    where canonical.department_id = duplicate.department_id
      and canonical.is_active
      and lower(btrim(canonical.name)) = lower(btrim(duplicate.name))
      and canonical.id < duplicate.id
  );

create unique index if not exists firearm_storage_locations_active_name_normalized
  on public.firearm_storage_locations (department_id, lower(btrim(name)))
  where is_active;

create or replace function public.update_firearm_storage_location(
  p_location_id uuid, p_name text, p_description text default null
) returns uuid language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
declare v_department_id uuid := tracepoint_auth.department_id(); v_id uuid;
begin
  if v_department_id is null or not public.has_department_permission(v_department_id, 'firearm_custody.manage_storage_locations') then raise exception 'storage-location permission required' using errcode='42501'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'storage location name is required' using errcode='22023'; end if;
  update public.firearm_storage_locations set name=btrim(p_name), description=nullif(btrim(p_description), ''), updated_at=now()
  where id=p_location_id and department_id=v_department_id and is_active returning id into v_id;
  if v_id is null then raise exception 'storage location unavailable' using errcode='22023'; end if;
  return v_id;
end $$;

create or replace function public.deactivate_firearm_storage_location(p_location_id uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
declare v_department_id uuid := tracepoint_auth.department_id(); v_id uuid;
begin
  if v_department_id is null or not public.has_department_permission(v_department_id, 'firearm_custody.manage_storage_locations') then raise exception 'storage-location permission required' using errcode='42501'; end if;
  update public.firearm_storage_locations set is_active=false, updated_at=now()
  where id=p_location_id and department_id=v_department_id and is_active returning id into v_id;
  if v_id is null then raise exception 'storage location unavailable' using errcode='22023'; end if;
  return v_id;
end $$;

revoke all on function public.update_firearm_storage_location(uuid,text,text) from public, anon, service_role, tracepoint_runtime;
revoke all on function public.deactivate_firearm_storage_location(uuid) from public, anon, service_role, tracepoint_runtime;
grant execute on function public.update_firearm_storage_location(uuid,text,text) to authenticated;
grant execute on function public.deactivate_firearm_storage_location(uuid) to authenticated;

commit;
