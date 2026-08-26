-- Fleet V1 role and permission registration.
-- Adds product-level Fleet capabilities and default Fleet roles.
-- Existing department overrides remain editable.

insert into public.permissions (
  code,
  display_name,
  description
)
values
  (
    'view_fleet',
    'View Fleet',
    'View Fleet Management vehicles, readiness, inspections, maintenance, equipment, and records.'
  ),
  (
    'manage_fleet',
    'Manage Fleet',
    'Create and update vehicles, vehicle status, equipment, documents, and Fleet operational records.'
  ),
  (
    'perform_fleet_inspections',
    'Perform Fleet Inspections',
    'Complete agency vehicle inspection workflows.'
  ),
  (
    'manage_fleet_maintenance',
    'Manage Fleet Maintenance',
    'Create, assign, update, and complete Fleet maintenance and repair work orders.'
  ),
  (
    'manage_fleet_rules',
    'Manage Fleet Rules',
    'Configure Fleet rules, inspection templates, role routing, readiness behavior, and notifications.'
  )
on conflict (code) do update
set
  display_name = excluded.display_name,
  description = excluded.description;


insert into public.roles (
  code,
  display_name,
  description,
  sort_order
)
values
  (
    'fleet_manager',
    'Fleet Manager',
    'Fleet administration, vehicle readiness, inspections, maintenance, and Fleet configuration.',
    45
  ),
  (
    'mechanic',
    'Mechanic',
    'Fleet maintenance and repair workflow access.',
    46
  )
on conflict (code) do update
set
  display_name = excluded.display_name,
  description = excluded.description,
  sort_order = excluded.sort_order;


-- Product default matrix for newly provisioned departments.

insert into public.role_permissions (
  role_code,
  permission_code
)
values
  ('fleet_manager', 'view_fleet'),
  ('fleet_manager', 'manage_fleet'),
  ('fleet_manager', 'perform_fleet_inspections'),
  ('fleet_manager', 'manage_fleet_maintenance'),
  ('fleet_manager', 'manage_fleet_rules'),

  ('mechanic', 'view_fleet'),
  ('mechanic', 'manage_fleet_maintenance')
on conflict (role_code, permission_code) do nothing;


-- Seed the same role defaults into existing departments.
-- Department administrators may subsequently customize them.

insert into public.department_role_permissions (
  department_id,
  role_code,
  permission_code,
  granted_by
)
select
  department.id,
  defaults.role_code,
  defaults.permission_code,
  department.created_by
from public.departments department
cross join (
  values
    ('fleet_manager'::text, 'view_fleet'::text),
    ('fleet_manager'::text, 'manage_fleet'::text),
    ('fleet_manager'::text, 'perform_fleet_inspections'::text),
    ('fleet_manager'::text, 'manage_fleet_maintenance'::text),
    ('fleet_manager'::text, 'manage_fleet_rules'::text),

    ('mechanic'::text, 'view_fleet'::text),
    ('mechanic'::text, 'manage_fleet_maintenance'::text)
) as defaults(role_code, permission_code)
on conflict (
  department_id,
  role_code,
  permission_code
) do nothing;
