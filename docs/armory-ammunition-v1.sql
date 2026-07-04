-- TracePoint Armory Ammunition v1
-- Run in Supabase SQL Editor before using /firearms/ammunition.

create table if not exists public.pilot_ammunition_workspaces (
  department_id uuid primary key references public.departments(id) on delete cascade,
  workspace jsonb not null default '{"dutyLots":[],"trainingLots":[],"transactions":[]}'::jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.pilot_ammunition_workspaces enable row level security;

drop policy if exists "pilot_ammunition_workspaces_select" on public.pilot_ammunition_workspaces;
drop policy if exists "pilot_ammunition_workspaces_insert" on public.pilot_ammunition_workspaces;
drop policy if exists "pilot_ammunition_workspaces_update" on public.pilot_ammunition_workspaces;
drop policy if exists "pilot_ammunition_workspaces_delete" on public.pilot_ammunition_workspaces;

create policy "pilot_ammunition_workspaces_select"
on public.pilot_ammunition_workspaces
for select
using (
  public.is_department_member(department_id)
);

create policy "pilot_ammunition_workspaces_insert"
on public.pilot_ammunition_workspaces
for insert
with check (
  public.has_department_permission(department_id, 'administer_department')
  or public.has_department_permission(department_id, 'manage_firearms')
  or public.has_department_permission(department_id, 'manage_armory')
);

create policy "pilot_ammunition_workspaces_update"
on public.pilot_ammunition_workspaces
for update
using (
  public.has_department_permission(department_id, 'administer_department')
  or public.has_department_permission(department_id, 'manage_firearms')
  or public.has_department_permission(department_id, 'manage_armory')
)
with check (
  public.has_department_permission(department_id, 'administer_department')
  or public.has_department_permission(department_id, 'manage_firearms')
  or public.has_department_permission(department_id, 'manage_armory')
);

create policy "pilot_ammunition_workspaces_delete"
on public.pilot_ammunition_workspaces
for delete
using (
  public.has_department_permission(department_id, 'administer_department')
);

create index if not exists pilot_ammunition_workspaces_updated_at_idx
on public.pilot_ammunition_workspaces(updated_at desc);
