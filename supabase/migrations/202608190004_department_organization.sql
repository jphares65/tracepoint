-- TracePoint Department Organization
-- Agency-configurable titles/ranks, units, and specialty groups.
-- Existing department_memberships.rank_title and unit_name remain
-- untouched for compatibility during the migration period.

create table if not exists public.department_titles (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint department_titles_name_not_blank
    check (nullif(trim(name), '') is not null)
);

create unique index if not exists uq_department_titles_name
  on public.department_titles (
    department_id,
    lower(trim(name))
  );

create index if not exists idx_department_titles_department
  on public.department_titles (
    department_id,
    is_active,
    sort_order,
    name
  );


create table if not exists public.department_units (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null,
  description text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint department_units_name_not_blank
    check (nullif(trim(name), '') is not null)
);

create unique index if not exists uq_department_units_name
  on public.department_units (
    department_id,
    lower(trim(name))
  );

create index if not exists idx_department_units_department
  on public.department_units (
    department_id,
    is_active,
    sort_order,
    name
  );


create table if not exists public.department_groups (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null,
  description text,
  group_type text not null default 'specialty',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint department_groups_name_not_blank
    check (nullif(trim(name), '') is not null),

  constraint department_groups_type_valid
    check (
      group_type in (
        'specialty',
        'team',
        'assignment',
        'other'
      )
    )
);

create unique index if not exists uq_department_groups_name
  on public.department_groups (
    department_id,
    lower(trim(name))
  );

create index if not exists idx_department_groups_department
  on public.department_groups (
    department_id,
    is_active,
    sort_order,
    name
  );


create table if not exists public.department_group_members (
  department_id uuid not null references public.departments(id) on delete cascade,
  group_id uuid not null references public.department_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id),
  assigned_at timestamptz not null default now(),

  primary key (department_id, group_id, user_id),

  constraint department_group_members_membership_fk
    foreign key (department_id, user_id)
    references public.department_memberships(department_id, user_id)
    on delete cascade
);

create index if not exists idx_department_group_members_user
  on public.department_group_members (
    department_id,
    user_id
  );


-- ------------------------------------------------------------
-- Seed organization values from existing personnel records.
-- This converts existing agency-specific free text into reusable
-- organization configuration without altering personnel records.
-- ------------------------------------------------------------

insert into public.department_titles (
  department_id,
  name,
  sort_order
)
select distinct
  membership.department_id,
  trim(membership.rank_title),
  100
from public.department_memberships membership
where nullif(trim(membership.rank_title), '') is not null
on conflict do nothing;


insert into public.department_units (
  department_id,
  name,
  sort_order
)
select distinct
  membership.department_id,
  trim(membership.unit_name),
  100
from public.department_memberships membership
where nullif(trim(membership.unit_name), '') is not null
on conflict do nothing;


-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

alter table public.department_titles enable row level security;
alter table public.department_units enable row level security;
alter table public.department_groups enable row level security;
alter table public.department_group_members enable row level security;


drop policy if exists department_titles_select_member
  on public.department_titles;

create policy department_titles_select_member
on public.department_titles
for select
to authenticated
using (
  exists (
    select 1
    from public.department_memberships membership
    where membership.department_id = department_titles.department_id
      and membership.user_id = auth.uid()
      and membership.is_active
  )
);


drop policy if exists department_titles_manage_admin
  on public.department_titles;

create policy department_titles_manage_admin
on public.department_titles
for all
to authenticated
using (
  public.has_department_permission(
    department_titles.department_id,
    'administer_department'
  )
)
with check (
  public.has_department_permission(
    department_titles.department_id,
    'administer_department'
  )
);


drop policy if exists department_units_select_member
  on public.department_units;

create policy department_units_select_member
on public.department_units
for select
to authenticated
using (
  exists (
    select 1
    from public.department_memberships membership
    where membership.department_id = department_units.department_id
      and membership.user_id = auth.uid()
      and membership.is_active
  )
);


drop policy if exists department_units_manage_admin
  on public.department_units;

create policy department_units_manage_admin
on public.department_units
for all
to authenticated
using (
  public.has_department_permission(
    department_units.department_id,
    'administer_department'
  )
)
with check (
  public.has_department_permission(
    department_units.department_id,
    'administer_department'
  )
);


drop policy if exists department_groups_select_member
  on public.department_groups;

create policy department_groups_select_member
on public.department_groups
for select
to authenticated
using (
  exists (
    select 1
    from public.department_memberships membership
    where membership.department_id = department_groups.department_id
      and membership.user_id = auth.uid()
      and membership.is_active
  )
);


drop policy if exists department_groups_manage_admin
  on public.department_groups;

create policy department_groups_manage_admin
on public.department_groups
for all
to authenticated
using (
  public.has_department_permission(
    department_groups.department_id,
    'administer_department'
  )
)
with check (
  public.has_department_permission(
    department_groups.department_id,
    'administer_department'
  )
);


drop policy if exists department_group_members_select_member
  on public.department_group_members;

create policy department_group_members_select_member
on public.department_group_members
for select
to authenticated
using (
  exists (
    select 1
    from public.department_memberships membership
    where membership.department_id =
          department_group_members.department_id
      and membership.user_id = auth.uid()
      and membership.is_active
  )
);


drop policy if exists department_group_members_manage_admin
  on public.department_group_members;

create policy department_group_members_manage_admin
on public.department_group_members
for all
to authenticated
using (
  public.has_department_permission(
    department_group_members.department_id,
    'administer_department'
  )
)
with check (
  public.has_department_permission(
    department_group_members.department_id,
    'administer_department'
  )
);


grant select on public.department_titles to authenticated;
grant select on public.department_units to authenticated;
grant select on public.department_groups to authenticated;
grant select on public.department_group_members to authenticated;

grant insert, update, delete
  on public.department_titles
  to authenticated;

grant insert, update, delete
  on public.department_units
  to authenticated;

grant insert, update, delete
  on public.department_groups
  to authenticated;

grant insert, update, delete
  on public.department_group_members
  to authenticated;
