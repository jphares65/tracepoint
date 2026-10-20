begin;

-- RNG-03: packet status "Ready" is a planning milestone, not a close-out. The
-- range workspace trigger and the relational drill-history trigger treated it as
-- finalized, so a day locked before anyone shot. On the AWS-native runtime the
-- API writes as `authenticated`, so the trigger fires and duplicated the API
-- rule. Both functions are recreated with only Completed / Locked / Archived as
-- final. Bodies are otherwise identical to 202609060002 and 202609030001;
-- `create or replace` keeps the existing triggers and makes this idempotent.
create or replace function public.protect_pilot_range_workspace_mutation()
returns trigger
language plpgsql
set search_path = public, auth
as $$
declare
  old_day jsonb;
  next_day jsonb;
  day_id text;
  is_manager boolean;
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then return new; end if;

  is_manager := public.has_any_department_permission(
    old.department_id,
    array['manage_range_days', 'administer_department']
  );

  if not is_manager and not public.has_any_department_permission(
    old.department_id,
    array['score_range_days', 'manage_qualifications']
  ) then
    raise exception using errcode = '42501', message = 'Range record management permission is required.';
  end if;

  if new.department_id is distinct from old.department_id then
    raise exception using errcode = '42501', message = 'Range workspace agency ownership cannot be changed.';
  end if;

  if not is_manager and (
    public.range_workspace_collection(old.workspace, 'rangeDays', 'range_days') is distinct from public.range_workspace_collection(new.workspace, 'rangeDays', 'range_days')
    or public.range_workspace_collection(old.workspace, 'drillLibrary', 'drill_library') is distinct from public.range_workspace_collection(new.workspace, 'drillLibrary', 'drill_library')
    or public.range_workspace_collection(old.workspace, 'rangeDayDrills', 'range_day_drills') is distinct from public.range_workspace_collection(new.workspace, 'rangeDayDrills', 'range_day_drills')
    or public.range_workspace_collection(old.workspace, 'rangeRoster', 'range_roster') is distinct from public.range_workspace_collection(new.workspace, 'rangeRoster', 'range_roster')
  ) then
    raise exception using errcode = '42501', message = 'Range-day planning changes require range management permission.';
  end if;

  for old_day in
    select value from jsonb_array_elements(public.range_workspace_collection(old.workspace, 'rangeDays', 'range_days'))
    where lower(coalesce(value ->> 'status', '')) in ('completed', 'locked', 'archived')
  loop
    day_id := old_day ->> 'id';
    select value into next_day
    from jsonb_array_elements(public.range_workspace_collection(new.workspace, 'rangeDays', 'range_days'))
    where value ->> 'id' = day_id
    limit 1;

    if next_day is distinct from old_day
      or public.range_workspace_day_items(old.workspace, 'rangeDayDrills', 'range_day_drills', day_id) is distinct from public.range_workspace_day_items(new.workspace, 'rangeDayDrills', 'range_day_drills', day_id)
      or public.range_workspace_day_items(old.workspace, 'rangeRoster', 'range_roster', day_id) is distinct from public.range_workspace_day_items(new.workspace, 'rangeRoster', 'range_roster', day_id)
      or public.range_workspace_day_items(old.workspace, 'results', 'drill_run_results', day_id) is distinct from public.range_workspace_day_items(new.workspace, 'results', 'drill_run_results', day_id)
      or public.range_workspace_day_items(old.workspace, 'malfunctions', 'firearm_malfunctions', day_id) is distinct from public.range_workspace_day_items(new.workspace, 'malfunctions', 'firearm_malfunctions', day_id)
    then
      raise exception using errcode = '23514', message = 'Finalized range history cannot be changed.';
    end if;
  end loop;

  return new;
end;
$$;

create or replace function public.protect_range_day_drill_history()
returns trigger language plpgsql set search_path = public as $$
declare parent_status text;
begin
  select status::text into parent_status
  from public.range_days
  where id = old.range_day_id and department_id = old.department_id;

  if lower(coalesce(parent_status, '')) in ('completed', 'locked', 'archived') then
    raise exception using errcode = '23514',
      message = 'The drill cannot be removed because the range day or packet is finalized or locked.';
  end if;
  return old;
end;
$$;

commit;
