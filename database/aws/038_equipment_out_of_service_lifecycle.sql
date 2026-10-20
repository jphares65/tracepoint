begin;

-- The application, custody check-in and equipment readiness all write
-- lifecycle_status = 'out_of_service', but the tracked schema only allowed
-- active/maintenance/expired/removed. Production was repaired by the one-off
-- final-target preparation script; this makes every other environment (clean
-- bootstrap, staging rebuilds, disaster recovery) match it. Idempotent: the
-- resulting constraint is identical to the production repair.
alter table public.equipment_assets drop constraint if exists equipment_assets_lifecycle_status_check;
alter table public.equipment_assets add constraint equipment_assets_lifecycle_status_check
  check (lifecycle_status in ('active', 'maintenance', 'expired', 'removed', 'out_of_service'));

commit;
