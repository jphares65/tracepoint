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

-- RNG-01 correction history must survive a writer that does not keep it. The
-- previous image's PUT /api/pilot/range-workspace rebuilds the document from
-- six collections, so during a rollback or a mixed deployment its next save
-- would drop workspace.resultRevisions, and its own corrections would leave no
-- revision. Before each update the stored history is kept in front of what the
-- write sends (append-only: entries already stored keep their stored value;
-- new entries are appended). Every stored result or malfunction the write
-- changes or removes without a sent revision of that stored version gets one,
-- marked recordedBy = database, by the session subject. The current image
-- sends those revisions itself, so its writes are stored unchanged. Removals
-- stay removals.
create or replace function public.keep_range_result_revisions()
returns trigger
language plpgsql
set search_path = pg_catalog, public, tracepoint_auth
as $$
declare
  v_old jsonb := coalesce(old.workspace, '{}'::jsonb);
  v_new jsonb := new.workspace;
  v_history jsonb;
  v_added jsonb;
  v_at text;
  v_actor uuid;
  v_collection text;
  v_before jsonb;
  v_after jsonb;
  v_item jsonb;
  v_current jsonb;
  v_id text;
begin
  if jsonb_typeof(v_new) is distinct from 'object' then return new; end if;
  v_history := public.range_workspace_collection(v_old, 'resultRevisions', 'result_revisions');
  if jsonb_typeof(v_history) is distinct from 'array' then v_history := '[]'::jsonb; end if;

  select coalesce(jsonb_agg(i.entry order by i.ord), '[]'::jsonb) into v_added
  from jsonb_array_elements(case when jsonb_typeof(v_new -> 'resultRevisions') = 'array'
    then v_new -> 'resultRevisions' else '[]'::jsonb end) with ordinality i(entry, ord)
  where not exists (
    select 1 from jsonb_array_elements(v_history) h(entry)
    where h.entry = i.entry or (jsonb_typeof(i.entry -> 'id') = 'string' and h.entry -> 'id' = i.entry -> 'id'));

  v_at := to_char(new.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_actor := coalesce(tracepoint_auth.subject_id(), new.updated_by_user_id);
  foreach v_collection in array array['results', 'malfunctions'] loop
    v_before := public.range_workspace_collection(v_old, v_collection,
      case v_collection when 'results' then 'drill_run_results' else 'firearm_malfunctions' end);
    v_after := public.range_workspace_collection(v_new, v_collection,
      case v_collection when 'results' then 'drill_run_results' else 'firearm_malfunctions' end);
    if jsonb_typeof(v_before) is distinct from 'array' then continue; end if;
    if jsonb_typeof(v_after) is distinct from 'array' then v_after := '[]'::jsonb; end if;
    for v_item in select b.item from jsonb_array_elements(v_before) with ordinality b(item, ord)
      where jsonb_typeof(b.item) = 'object' order by b.ord loop
      v_id := case when jsonb_typeof(v_item -> 'id') = 'string' then btrim(v_item ->> 'id') else '' end;
      select a.item into v_current from jsonb_array_elements(v_after) with ordinality a(item, ord)
      where jsonb_typeof(a.item) = 'object' and case when v_id <> ''
        then jsonb_typeof(a.item -> 'id') = 'string' and btrim(a.item ->> 'id') = v_id
        else a.item = v_item end
      order by a.ord limit 1;
      if v_current is not null and v_current = v_item then continue; end if;
      if exists (select 1 from jsonb_array_elements(v_added) r(entry)
        where r.entry -> 'previous' = v_item and r.entry ->> 'collection' = v_collection) then continue; end if;
      v_added := v_added || jsonb_build_array(jsonb_build_object(
        'id', 'revision-' || v_at || '-db-' || (jsonb_array_length(v_history) + jsonb_array_length(v_added)),
        'collection', v_collection,
        'recordId', v_id,
        'rangeDayId', case when jsonb_typeof(coalesce(nullif(v_item -> 'rangeDayId', 'null'::jsonb), v_item -> 'range_day_id')) = 'string'
          then btrim(coalesce(nullif(v_item -> 'rangeDayId', 'null'::jsonb), v_item -> 'range_day_id') #>> '{}') else '' end,
        'replacedById', case when v_current is null then '' else v_id end,
        'revisedAt', v_at,
        'revisedByUserId', v_actor,
        'recordedBy', 'database',
        'previous', v_item));
    end loop;
  end loop;

  if (v_history || v_added) = '[]'::jsonb and not (v_new ? 'resultRevisions') then return new; end if;
  if v_new -> 'resultRevisions' is distinct from v_history || v_added then
    new.workspace := v_new || jsonb_build_object('resultRevisions', v_history || v_added);
  end if;
  return new;
end;
$$;

revoke all on function public.keep_range_result_revisions() from public, anon, authenticated, service_role;
drop trigger if exists pilot_range_workspaces_keep_result_revisions on public.pilot_range_workspaces;
create trigger pilot_range_workspaces_keep_result_revisions
before update on public.pilot_range_workspaces
for each row execute function public.keep_range_result_revisions();

commit;
