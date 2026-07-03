-- TracePoint Pilot Remediation Persistence
-- Run this in Supabase SQL Editor.

create table if not exists public.pilot_remediation_workspaces (
  department_id uuid primary key references public.departments(id) on delete cascade,
  remediations jsonb not null default '[]'::jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.pilot_remediation_workspaces enable row level security;

drop policy if exists "pilot_remediation_workspaces_select" on public.pilot_remediation_workspaces;
drop policy if exists "pilot_remediation_workspaces_insert" on public.pilot_remediation_workspaces;
drop policy if exists "pilot_remediation_workspaces_update" on public.pilot_remediation_workspaces;
drop policy if exists "pilot_remediation_workspaces_delete" on public.pilot_remediation_workspaces;

create policy "pilot_remediation_workspaces_select"
on public.pilot_remediation_workspaces
for select
using (
  public.is_department_member(department_id)
);

create policy "pilot_remediation_workspaces_insert"
on public.pilot_remediation_workspaces
for insert
with check (
  public.has_department_permission(department_id, 'manage_remediations')
  or public.has_department_permission(department_id, 'create_remediations')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy "pilot_remediation_workspaces_update"
on public.pilot_remediation_workspaces
for update
using (
  public.has_department_permission(department_id, 'manage_remediations')
  or public.has_department_permission(department_id, 'resolve_remediations')
  or public.has_department_permission(department_id, 'administer_department')
)
with check (
  public.has_department_permission(department_id, 'manage_remediations')
  or public.has_department_permission(department_id, 'resolve_remediations')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy "pilot_remediation_workspaces_delete"
on public.pilot_remediation_workspaces
for delete
using (
  public.has_department_permission(department_id, 'administer_department')
);

create index if not exists pilot_remediation_workspaces_updated_at_idx
on public.pilot_remediation_workspaces(updated_at desc);
