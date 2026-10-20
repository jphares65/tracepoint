begin;

-- RNG-07: an instructor (score_range_days without manage_range_days) runs the
-- line: marks attendance on existing roster entries and adds present walk-ups to
-- an Open / Rolling Attendance day. Every other roster change, and all other
-- planning, stays range management. Mirrors scorerRosterChangeAllowed in
-- src/lib/range/workspace-mutation.ts.
create or replace function public.range_workspace_scorer_roster_change_allowed(p_old jsonb, p_new jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  with old_roster as (
    select value from jsonb_array_elements(public.range_workspace_collection(p_old, 'rangeRoster', 'range_roster'))
  ), new_roster as (
    select value from jsonb_array_elements(public.range_workspace_collection(p_new, 'rangeRoster', 'range_roster'))
  ), days as (
    select value from jsonb_array_elements(public.range_workspace_collection(p_new, 'rangeDays', 'range_days'))
  )
  select
    not exists (
      select 1 from old_roster o
      where not exists (
        select 1 from new_roster n
        where (case when coalesce(o.value ->> 'id', '') <> '' then n.value ->> 'id' = o.value ->> 'id' else n.value = o.value end)
          and n.value - array['attended', 'attendanceTime', 'attendance_time']
            = o.value - array['attended', 'attendanceTime', 'attendance_time']
      )
    )
    and not exists (
      select 1 from new_roster n
      where not exists (
          select 1 from old_roster o
          where case when coalesce(n.value ->> 'id', '') <> '' then o.value ->> 'id' = n.value ->> 'id' else o.value = n.value end
        )
        and not (
          coalesce(n.value ->> 'id', '') <> ''
          and coalesce(n.value ->> 'officerId', n.value ->> 'officer_id', '') <> ''
          and n.value -> 'attended' = 'true'::jsonb
          and exists (
            select 1 from days d
            where d.value ->> 'id' = coalesce(n.value ->> 'rangeDayId', n.value ->> 'range_day_id')
              and coalesce(d.value ->> 'attendanceMode', d.value ->> 'attendance_mode') = 'Open / Rolling Attendance'
          )
          and (
            select count(*) from new_roster m
            where coalesce(m.value ->> 'rangeDayId', m.value ->> 'range_day_id') = coalesce(n.value ->> 'rangeDayId', n.value ->> 'range_day_id')
              and coalesce(m.value ->> 'officerId', m.value ->> 'officer_id') = coalesce(n.value ->> 'officerId', n.value ->> 'officer_id')
          ) = 1
        )
    )
$$;

-- Body identical to 042 except the rangeRoster clause, which now admits the
-- instructor attendance changes above.
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
    or (
      public.range_workspace_collection(old.workspace, 'rangeRoster', 'range_roster') is distinct from public.range_workspace_collection(new.workspace, 'rangeRoster', 'range_roster')
      and not public.range_workspace_scorer_roster_change_allowed(old.workspace, new.workspace)
    )
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

-- RNG-12: instructors attach target photos to the results they score, with the
-- route's audit row. Additive policies; the existing ones are unchanged.
drop policy if exists attachments_insert_qualification_evidence on public.attachments;
create policy attachments_insert_qualification_evidence
on public.attachments for insert to authenticated
with check (
  uploaded_by_user_id = tracepoint_auth.subject_id()
  and entity_type = 'qualification'
  and public.has_department_permission(department_id, 'score_range_days')
);

drop policy if exists audit_events_insert_qualification_evidence on public.audit_events;
create policy audit_events_insert_qualification_evidence
on public.audit_events for insert to authenticated
with check (
  actor_user_id = tracepoint_auth.subject_id()
  and action = 'qualification_evidence_uploaded'
  and entity_type = 'qualification'
  and public.has_department_permission(department_id, 'score_range_days')
);

-- RNG-12: evidence on an imported result (qualification_results) is readable by
-- that result's officer, as 048 already allows for range-workspace results.
drop policy if exists attachments_select on public.attachments;
create policy attachments_select
on public.attachments for select to authenticated
using (
  public.is_department_member(department_id)
  and (
    entity_type <> 'qualification'
    or uploaded_by_user_id = tracepoint_auth.subject_id()
    or public.has_any_department_permission(department_id,
      array['manage_qualifications', 'manage_range_days', 'score_range_days', 'view_analytics', 'administer_department'])
    or exists (
      select 1
      from public.pilot_range_workspaces workspace
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(workspace.workspace -> 'results') = 'array'
          then workspace.workspace -> 'results' else '[]'::jsonb end) result
      where workspace.department_id = attachments.department_id
        and result ->> 'id' = attachments.entity_key
        and coalesce(result ->> 'officerId', result ->> 'officerUserId', result ->> 'officer_user_id', result ->> 'officer_id')
          = tracepoint_auth.subject_id()::text
    )
    or exists (
      select 1
      from public.qualification_results imported
      where imported.department_id = attachments.department_id
        and imported.id::text = attachments.entity_key
        and imported.officer_user_id = tracepoint_auth.subject_id()
    )
  )
);

commit;
