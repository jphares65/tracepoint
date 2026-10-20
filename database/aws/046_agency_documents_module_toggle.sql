begin;

-- Agency Documents becomes an operational module that a platform administrator
-- turns on per agency. Unlike the modules seeded by 042 it starts disabled:
-- every agency, existing or new, receives an explicit disabled entitlement row.
-- Keep the catalog row in sync with src/lib/tracepoint/module-catalog.ts.
alter table public.feature_catalog
  add column if not exists default_enabled boolean not null default true;

create or replace function tracepoint_auth.provision_missing_department_features(
  p_department_id uuid,
  p_reason text,
  p_actor_id uuid default null
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  with inserted as (
    insert into public.department_features(
      department_id, feature_code, is_enabled, enabled_at, disabled_at, updated_at, updated_by
    )
    select p_department_id, feature.code, feature.default_enabled,
      case when feature.default_enabled then now() end,
      case when feature.default_enabled then null else now() end,
      now(), p_actor_id
    from public.feature_catalog feature
    where feature.is_active
    on conflict (department_id, feature_code) do nothing
    returning department_id, feature_code, is_enabled
  )
  insert into public.department_feature_events(
    department_id, feature_code, previous_enabled, new_enabled, actor_user_id, reason
  )
  select department_id, feature_code, null, is_enabled, p_actor_id, p_reason
  from inserted;
end;
$$;

create or replace function tracepoint_auth.provision_feature_for_existing_departments()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not new.is_active or (tg_op = 'UPDATE' and old.is_active) then
    return new;
  end if;
  perform tracepoint_auth.provision_missing_department_features(
    department.id,
    case when new.default_enabled
      then 'New module enabled by the operational feature catalog.'
      else 'New module added to the operational feature catalog; disabled until a platform administrator enables it.'
    end,
    tracepoint_auth.subject_id()
  )
  from public.departments department;
  return new;
end;
$$;

revoke all on function tracepoint_auth.provision_missing_department_features(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function tracepoint_auth.provision_feature_for_existing_departments() from public, anon, authenticated, service_role;

-- The insert fires feature_catalog_default_department_entitlements (042), which
-- now records a disabled row and event for every existing agency. A replay
-- refreshes the display text only; it never re-enables, re-activates or
-- changes the default of a module an administrator has since configured.
insert into public.feature_catalog(code, display_name, description, sort_order, is_active, default_enabled)
values ('agency_documents', 'Agency Documents', 'Agency form templates and documents generated from TracePoint records.', 95, true, false)
on conflict (code) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  sort_order = excluded.sort_order;

commit;
