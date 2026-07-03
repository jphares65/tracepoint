-- TracePoint Pilot Data Bridge 1
-- This creates a department-level Supabase-backed workspace for the current
-- Range & Training / Qualification History UI.
--
-- Purpose:
-- - Move pilot range-day, roster, drill, qualification, and score data out of
--   browser-only localStorage.
-- - Preserve the existing working UI while we prepare the normalized Supabase
--   migration for range_days, range_day_roster, range_day_drills,
--   drill_run_results, qualification_results, alerts, and remediations.

create table if not exists public.pilot_range_workspaces (
  department_id uuid primary key references public.departments(id) on delete cascade,
  workspace jsonb not null default '{}'::jsonb,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists pilot_range_workspaces_updated_at_idx
  on public.pilot_range_workspaces(updated_at desc);

alter table public.pilot_range_workspaces enable row level security;

drop policy if exists "pilot_range_workspaces_select_members" on public.pilot_range_workspaces;
drop policy if exists "pilot_range_workspaces_insert_members" on public.pilot_range_workspaces;
drop policy if exists "pilot_range_workspaces_update_members" on public.pilot_range_workspaces;

create policy "pilot_range_workspaces_select_members"
on public.pilot_range_workspaces
for select
using (
  exists (
    select 1
    from public.department_memberships dm
    where dm.department_id = pilot_range_workspaces.department_id
      and dm.user_id = auth.uid()
      and dm.is_active = true
  )
);

create policy "pilot_range_workspaces_insert_members"
on public.pilot_range_workspaces
for insert
with check (
  exists (
    select 1
    from public.department_memberships dm
    where dm.department_id = pilot_range_workspaces.department_id
      and dm.user_id = auth.uid()
      and dm.is_active = true
  )
);

create policy "pilot_range_workspaces_update_members"
on public.pilot_range_workspaces
for update
using (
  exists (
    select 1
    from public.department_memberships dm
    where dm.department_id = pilot_range_workspaces.department_id
      and dm.user_id = auth.uid()
      and dm.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.department_memberships dm
    where dm.department_id = pilot_range_workspaces.department_id
      and dm.user_id = auth.uid()
      and dm.is_active = true
  )
);
