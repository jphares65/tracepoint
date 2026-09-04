-- The equipment workspace originally shipped against tables created directly
-- in production. Define that base schema here so the tracked migration chain
-- is complete for new projects. IF NOT EXISTS preserves existing data.
create table if not exists public.equipment_types (
    id uuid primary key default gen_random_uuid(),
    department_id uuid not null references public.departments(id) on delete cascade,
    name text not null,
    category text not null default 'Other',
    description text,
    expiration_required boolean not null default false,
    default_valid_days integer,
    default_due_soon_days integer not null default 30,
    inspection_required boolean not null default false,
    default_inspection_interval_days integer,
    default_inspection_due_soon_days integer not null default 30,
    is_active boolean not null default true,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (department_id, name)
);

create table if not exists public.equipment_assets (
    id uuid primary key default gen_random_uuid(),
    department_id uuid not null references public.departments(id) on delete cascade,
    equipment_type_id uuid not null references public.equipment_types(id) on delete restrict,
    asset_number text,
    manufacturer text,
    model text,
    serial_number text,
    lot_number text,
    assigned_user_id uuid references auth.users(id) on delete set null,
    assigned_location text,
    issue_date date,
    expiration_date date,
    last_inspection_date date,
    next_inspection_date date,
    lifecycle_status text not null default 'active'
        check (lifecycle_status in ('active', 'maintenance', 'expired', 'removed')),
    document_url text,
    notes text,
    removed_at timestamptz,
    removed_by uuid references auth.users(id) on delete set null,
    removal_reason text,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.department_equipment_requirements (
    id uuid primary key default gen_random_uuid(),
    department_id uuid not null references public.departments(id) on delete cascade,
    equipment_type_id uuid not null references public.equipment_types(id) on delete cascade,
    is_required boolean not null default true,
    required_quantity integer not null default 1 check (required_quantity > 0),
    valid_days integer,
    due_soon_days integer,
    inspection_interval_days integer,
    inspection_due_soon_days integer,
    is_active boolean not null default true,
    notes text,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (department_id, equipment_type_id)
);

create table if not exists public.equipment_asset_assignments (
    id uuid primary key default gen_random_uuid(),

    department_id uuid not null
        references public.departments(id) on delete cascade,

    equipment_asset_id uuid not null
        references public.equipment_assets(id) on delete cascade,

    assigned_user_id uuid not null
        references auth.users(id),

    assigned_at timestamptz not null default now(),
    assigned_by uuid null
        references auth.users(id),

    returned_at timestamptz null,
    returned_by uuid null
        references auth.users(id),

    assignment_notes text null,
    return_notes text null,

    created_at timestamptz not null default now(),

    constraint equipment_asset_assignments_return_after_assignment
        check (
            returned_at is null
            or returned_at >= assigned_at
        )
);

create index if not exists idx_equipment_asset_assignments_department
    on public.equipment_asset_assignments(department_id);

create index if not exists idx_equipment_asset_assignments_asset
    on public.equipment_asset_assignments(equipment_asset_id);

create index if not exists idx_equipment_asset_assignments_user
    on public.equipment_asset_assignments(department_id, assigned_user_id);

create unique index if not exists uq_equipment_asset_active_assignment
    on public.equipment_asset_assignments(equipment_asset_id)
    where returned_at is null;

-- Seed current assignments so existing TracePoint equipment does not lose history.
insert into public.equipment_asset_assignments (
    department_id,
    equipment_asset_id,
    assigned_user_id,
    assigned_at,
    assigned_by,
    assignment_notes
)
select
    ea.department_id,
    ea.id,
    ea.assigned_user_id,
    coalesce(ea.issue_date::timestamptz, ea.created_at, now()),
    ea.created_by,
    'Initial assignment migrated from equipment asset record'
from public.equipment_assets ea
where ea.assigned_user_id is not null
  and not exists (
      select 1
      from public.equipment_asset_assignments eaa
      where eaa.equipment_asset_id = ea.id
        and eaa.returned_at is null
  );

alter table public.equipment_asset_assignments enable row level security;
