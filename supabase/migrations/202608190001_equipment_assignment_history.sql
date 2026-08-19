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
