\set ON_ERROR_STOP 0
-- P1: mirrors postgres-data-client.ts where() for qr/resolve .or(`id.eq.${v},unit_number.eq.${v},vin.eq.${v}`): one untyped param per alternative
create table fleet_vehicles(id uuid primary key, department_id uuid, unit_number text, vin text);
insert into fleet_vehicles values ('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000001','3101',null);
prepare qr(unknown, unknown, unknown, unknown) as select id, unit_number from fleet_vehicles t where t.department_id = $1 and (t.id = $2 or t.unit_number = $3 or t.vin = $4);
execute qr('00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111');
execute qr('00000000-0000-4000-8000-000000000001','3101','3101','3101');
-- P2: tracked-migration CHECK (supabase/migrations/202608190001_equipment_assignment_history.sql:39-40)
create table equipment_assets(id int primary key, lifecycle_status text not null default 'active' check (lifecycle_status in ('active', 'maintenance', 'expired', 'removed')));
insert into equipment_assets(id) values (1);
update equipment_assets set lifecycle_status = 'out_of_service' where id = 1;
-- P3: after scripts/final-target-fixed-schema-prep.cjs:88-89 repair
alter table equipment_assets drop constraint equipment_assets_lifecycle_status_check;
alter table equipment_assets add constraint equipment_assets_lifecycle_status_check check (lifecycle_status in ('active','maintenance','expired','removed','out_of_service'));
update equipment_assets set lifecycle_status = 'out_of_service' where id = 1;
select * from equipment_assets;
