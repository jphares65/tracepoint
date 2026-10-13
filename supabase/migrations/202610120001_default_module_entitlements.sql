begin;

-- The feature catalog is the persisted runtime catalog. Keep this seed in sync
-- with src/lib/tracepoint/module-catalog.ts (covered by migration contract tests).
insert into public.feature_catalog(code, display_name, description, sort_order, is_active)
values
  ('ammunition', 'Ammunition', 'Ammunition inventory and transactions.', 10, true),
  ('analytics', 'Analytics', 'Agency analytics and reports.', 20, true),
  ('certifications', 'Certifications', 'Agency certification records and readiness.', 30, true),
  ('command_dashboard', 'Command Dashboard', 'Command dashboard and operational readiness.', 40, true),
  ('equipment_readiness', 'Equipment Readiness', 'Equipment inventory, assignment, and readiness.', 50, true),
  ('fleet', 'Fleet', 'Agency vehicle inspections, maintenance, and fleet records.', 55, true),
  ('firearms', 'Firearms', 'Agency and personally owned firearm records.', 60, true),
  ('inventory', 'Inventory', 'Agency supply inventory, locations, and checkouts.', 65, true),
  ('off_duty', 'Off-duty Firearms', 'Off-duty firearm requests and approvals.', 70, true),
  ('qualifications', 'Qualifications', 'Officer qualification records and standards.', 80, true),
  ('range_training', 'Range and Training', 'Range days, agency training, and digital packets.', 90, true)
on conflict (code) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  sort_order = excluded.sort_order;

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
    select p_department_id, feature.code, true, now(), null, now(), p_actor_id
    from public.feature_catalog feature
    where feature.is_active
    on conflict (department_id, feature_code) do nothing
    returning department_id, feature_code
  )
  insert into public.department_feature_events(
    department_id, feature_code, previous_enabled, new_enabled, actor_user_id, reason
  )
  select department_id, feature_code, null, true, p_actor_id, p_reason
  from inserted;
end;
$$;

create or replace function tracepoint_auth.provision_department_features_after_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform tracepoint_auth.provision_missing_department_features(
    new.id, 'Default-enabled modules provisioned for a new agency.', auth.uid()
  );
  return new;
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
    department.id, 'New module enabled by the operational feature catalog.', auth.uid()
  )
  from public.departments department;
  return new;
end;
$$;

revoke all on function tracepoint_auth.provision_missing_department_features(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function tracepoint_auth.provision_department_features_after_insert() from public, anon, authenticated, service_role;
revoke all on function tracepoint_auth.provision_feature_for_existing_departments() from public, anon, authenticated, service_role;

drop trigger if exists departments_default_module_entitlements on public.departments;
create trigger departments_default_module_entitlements
after insert on public.departments
for each row execute function tracepoint_auth.provision_department_features_after_insert();

drop trigger if exists feature_catalog_default_department_entitlements on public.feature_catalog;
create trigger feature_catalog_default_department_entitlements
after insert or update of is_active on public.feature_catalog
for each row execute function tracepoint_auth.provision_feature_for_existing_departments();

-- Missing rows are new entitlements, not explicit agency exceptions. Existing
-- rows, including disabled rows, are deliberately preserved by DO NOTHING.
with inserted as (
  insert into public.department_features(
    department_id, feature_code, is_enabled, enabled_at, disabled_at, updated_at, updated_by
  )
  select department.id, feature.code, true, now(), null, now(), null
  from public.departments department
  cross join public.feature_catalog feature
  where feature.is_active
  on conflict (department_id, feature_code) do nothing
  returning department_id, feature_code
)
insert into public.department_feature_events(
  department_id, feature_code, previous_enabled, new_enabled, actor_user_id, reason
)
select department_id, feature_code, null, true, null,
  'Default-enabled module entitlement backfill.'
from inserted;

commit;
