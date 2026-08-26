begin;

create table if not exists public.fleet_rules (
  department_id uuid primary key references public.departments(id) on delete cascade,
  status_automation_enabled boolean not null default true,
  due_soon_days integer not null default 30,
  default_service_miles integer,
  default_service_hours integer,
  default_service_days integer,
  inspection_warning_days integer not null default 30,
  warranty_warning_days integer not null default 60,
  registration_warning_days integer not null default 30,
  critical_issue_out_of_service boolean not null default true,
  critical_equipment_out_of_service boolean not null default true,
  require_return_to_service_approval boolean not null default true,
  notify_by_email boolean not null default true,
  escalation_hours integer not null default 24,
  fleet_manager_role_codes text[] not null default array['fleet_manager'],
  mechanic_role_codes text[] not null default array['mechanic','fleet_mechanic'],
  inspection_frequency_days integer not null default 1,
  inspection_types text[] not null default array['Pre-Shift','Post-Shift','Weekly'],
  inspection_role_codes text[] not null default array[]::text[],
  inspection_checklist jsonb not null default '[{"id":"body","label":"Body, windshield and mirrors"},{"id":"tires","label":"Tires and wheels"},{"id":"lights","label":"Lights, signals and siren"},{"id":"controls","label":"Brakes, steering and controls"},{"id":"fluids","label":"Fluids and visible leaks"},{"id":"interior","label":"Seatbelts and interior condition"}]'::jsonb,
  inspection_include_required_equipment boolean not null default true,
  inspection_defect_creates_work_order boolean not null default true,
  inspection_critical_out_of_service boolean not null default true,
  notify_mechanic_on_issue_report boolean not null default true,
  notify_mechanic_on_inspection_defect boolean not null default true,
  notify_fleet_manager_on_status_change boolean not null default true,
  updated_by_user_id uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.fleet_vehicles (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  unit_number text not null,
  vin text,
  license_plate text,
  year integer,
  make text,
  model text,
  vehicle_type text,
  assignment_type text not null default 'Pool',
  assigned_to text,
  home_location text,
  current_mileage integer not null default 0,
  current_hours numeric(10,1) not null default 0,
  status text not null default 'Available',
  status_reason text,
  status_override_active boolean not null default false,
  inspection_due_date date,
  registration_expiration_date date,
  insurance_expiration_date date,
  in_service_date date,
  last_service_date date,
  last_service_mileage integer,
  last_service_hours numeric(10,1),
  next_service_date date,
  next_service_mileage integer,
  next_service_hours numeric(10,1),
  open_issue_count integer not null default 0,
  comments text,
  notes text,
  retired_at timestamptz,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fleet_vehicle_unit_not_blank check (btrim(unit_number) <> ''),
  constraint fleet_vehicle_status_valid check (status in ('Available','Attention','Maintenance','Out of Service','Retired')),
  constraint fleet_vehicle_assignment_valid check (assignment_type in ('Pool','Permanent','Specialized')),
  constraint fleet_vehicle_vin_valid check (vin is null or char_length(vin) = 17),
  constraint fleet_vehicle_values_valid check (current_mileage >= 0 and current_hours >= 0 and open_issue_count >= 0)
);

create table if not exists public.fleet_work_orders (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete cascade,
  record_type text not null default 'Issue',
  issue_category text,
  title text not null,
  description text,
  priority text not null default 'Normal',
  status text not null default 'Open',
  affects_availability boolean not null default false,
  assigned_role_code text,
  assigned_user_id uuid,
  mechanic_name text,
  vendor text,
  mileage integer,
  hours numeric(10,1),
  reported_at timestamptz not null default now(),
  scheduled_for date,
  due_date date,
  started_at timestamptz,
  completed_at timestamptz,
  returned_to_service_at timestamptz,
  labor_cost numeric(12,2),
  parts_cost numeric(12,2),
  total_cost numeric(12,2),
  resolution text,
  notes text,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fleet_work_order_type_valid check (record_type in ('Issue','Preventive Maintenance','Repair','Inspection','Recall')),
  constraint fleet_work_order_priority_valid check (priority in ('Normal','High','Critical')),
  constraint fleet_work_order_status_valid check (status in ('Open','Assigned','Scheduled','In Progress','Awaiting Parts','Completed','Cancelled'))
);

create table if not exists public.fleet_vehicle_equipment (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete cascade,
  source_type text not null default 'Fleet Checklist',
  linked_equipment_asset_id uuid,
  category text not null,
  name text not null,
  make text,
  model text,
  year integer,
  serial_number text,
  tuning_fork_serial_number text,
  warranty_expiration_date date,
  static_ip text,
  quantity integer not null default 1,
  is_required boolean not null default false,
  is_critical boolean not null default false,
  status text not null default 'Current',
  notes text,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fleet_equipment_source_valid check (source_type in ('Linked Inventory','Fleet Checklist')),
  constraint fleet_equipment_status_valid check (status in ('Current','Attention','Missing','Out of Service','Removed')),
  constraint fleet_equipment_quantity_valid check (quantity > 0)
);

create table if not exists public.fleet_vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete cascade,
  document_type text not null,
  title text not null,
  document_url text,
  effective_date date,
  expiration_date date,
  notes text,
  created_by_user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.fleet_vehicle_inspections (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete cascade,
  inspection_type text not null default 'Pre-Shift',
  result text not null,
  mileage integer,
  hours numeric(10,1),
  checklist jsonb not null default '[]'::jsonb,
  defect_count integer not null default 0,
  critical_defect_count integer not null default 0,
  notes text,
  inspector_user_id uuid,
  inspected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint fleet_inspection_result_valid check (result in ('Passed','Passed with Defects','Failed')),
  constraint fleet_inspection_values_valid check (defect_count >= 0 and critical_defect_count >= 0 and (mileage is null or mileage >= 0) and (hours is null or hours >= 0))
);

create unique index if not exists fleet_vehicles_department_unit_unique on public.fleet_vehicles (department_id, lower(unit_number));
create unique index if not exists fleet_vehicles_department_vin_unique on public.fleet_vehicles (department_id, upper(vin)) where vin is not null and btrim(vin) <> '';
create unique index if not exists fleet_vehicles_department_plate_unique on public.fleet_vehicles (department_id, upper(license_plate)) where license_plate is not null and btrim(license_plate) <> '';
create index if not exists fleet_work_orders_vehicle_status_idx on public.fleet_work_orders (department_id, vehicle_id, status);
create index if not exists fleet_equipment_vehicle_idx on public.fleet_vehicle_equipment (department_id, vehicle_id);
create unique index if not exists fleet_equipment_link_unique on public.fleet_vehicle_equipment (department_id, linked_equipment_asset_id) where linked_equipment_asset_id is not null and status <> 'Removed';
create index if not exists fleet_documents_vehicle_idx on public.fleet_vehicle_documents (department_id, vehicle_id);
create index if not exists fleet_inspections_vehicle_date_idx on public.fleet_vehicle_inspections (department_id, vehicle_id, inspected_at desc);

alter table public.fleet_rules enable row level security;
alter table public.fleet_vehicles enable row level security;
alter table public.fleet_work_orders enable row level security;
alter table public.fleet_vehicle_equipment enable row level security;
alter table public.fleet_vehicle_documents enable row level security;
alter table public.fleet_vehicle_inspections enable row level security;

comment on table public.fleet_vehicles is 'Tenant-scoped Fleet vehicle master records. Server APIs enforce authorization and immutable auditing.';
comment on column public.fleet_vehicle_equipment.static_ip is 'Restricted fleet/IT detail; server APIs must omit it for users without management access.';

commit;
