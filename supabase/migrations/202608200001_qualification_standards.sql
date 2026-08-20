create table if not exists public.department_qualification_standards (
  id uuid primary key default gen_random_uuid(),

  department_id uuid not null
    references public.departments(id)
    on delete cascade,

  name text not null,

  firearm_type text null,

  validity_days integer null
    check (validity_days is null or validity_days > 0),

  description text null,

  is_active boolean not null default true,

  created_by uuid null
    references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists
  department_qualification_standards_name_unique
on public.department_qualification_standards (
  department_id,
  lower(trim(name))
);


create table if not exists public.department_qualification_standard_components (
  id uuid primary key default gen_random_uuid(),

  department_id uuid not null
    references public.departments(id)
    on delete cascade,

  qualification_standard_id uuid not null
    references public.department_qualification_standards(id)
    on delete cascade,

  name text not null,

  scoring_basis text not null
    check (
      scoring_basis in (
        'Points',
        'Percentage',
        'Time',
        'Pass/Fail',
        'Hit Count',
        'Completion'
      )
    ),

  maximum_score numeric null,

  passing_score numeric null,

  passing_time_seconds numeric null,

  minimum_hits integer null,

  is_required boolean not null default true,

  sort_order integer not null default 0,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (
    maximum_score is null
    or maximum_score >= 0
  ),

  check (
    passing_score is null
    or passing_score >= 0
  ),

  check (
    maximum_score is null
    or passing_score is null
    or passing_score <= maximum_score
  ),

  check (
    passing_time_seconds is null
    or passing_time_seconds >= 0
  ),

  check (
    minimum_hits is null
    or minimum_hits >= 0
  )
);

create unique index if not exists
  department_qualification_standard_components_name_unique
on public.department_qualification_standard_components (
  qualification_standard_id,
  lower(trim(name))
);


alter table public.department_qualification_standards
  enable row level security;

alter table public.department_qualification_standard_components
  enable row level security;


drop policy if exists
  "department members can view qualification standards"
on public.department_qualification_standards;

create policy
  "department members can view qualification standards"
on public.department_qualification_standards
for select
to authenticated
using (
  exists (
    select 1
    from public.department_memberships dm
    where dm.department_id =
      department_qualification_standards.department_id
      and dm.user_id = auth.uid()
      and dm.is_active = true
  )
);


drop policy if exists
  "department administrators can manage qualification standards"
on public.department_qualification_standards;

create policy
  "department administrators can manage qualification standards"
on public.department_qualification_standards
for all
to authenticated
using (
  public.has_department_permission(
    department_qualification_standards.department_id,
    'administer_department'
  )
)
with check (
  public.has_department_permission(
    department_qualification_standards.department_id,
    'administer_department'
  )
);


drop policy if exists
  "department members can view qualification standard components"
on public.department_qualification_standard_components;

create policy
  "department members can view qualification standard components"
on public.department_qualification_standard_components
for select
to authenticated
using (
  exists (
    select 1
    from public.department_memberships dm
    where dm.department_id =
      department_qualification_standard_components.department_id
      and dm.user_id = auth.uid()
      and dm.is_active = true
  )
);


drop policy if exists
  "department administrators can manage qualification standard components"
on public.department_qualification_standard_components;

create policy
  "department administrators can manage qualification standard components"
on public.department_qualification_standard_components
for all
to authenticated
using (
  public.has_department_permission(
    department_qualification_standard_components.department_id,
    'administer_department'
  )
)
with check (
  public.has_department_permission(
    department_qualification_standard_components.department_id,
    'administer_department'
  )
);


grant select
on public.department_qualification_standards
to authenticated;

grant select
on public.department_qualification_standard_components
to authenticated;

grant insert, update, delete
on public.department_qualification_standards
to authenticated;

grant insert, update, delete
on public.department_qualification_standard_components
to authenticated;
