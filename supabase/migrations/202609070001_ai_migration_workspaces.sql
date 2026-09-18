begin;

create table if not exists public.ai_migration_workspaces (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  updated_by_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'ready', 'partially_completed', 'completed', 'expired')),
  state jsonb not null default '{"version":1,"sources":[],"sharedMappings":[],"remediations":[],"mergeRules":[]}'::jsonb,
  file_count integer not null default 0 check (file_count between 0 and 50),
  source_row_count integer not null default 0 check (source_row_count between 0 and 50000),
  completed_domains text[] not null default '{}'::text[],
  last_validation_digest text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  constraint ai_migration_workspaces_state_object check (jsonb_typeof(state) = 'object'),
  constraint ai_migration_workspaces_completed_domains check (completed_domains <@ array['personnel', 'firearms', 'certifications', 'vehicles', 'equipment']::text[]),
  constraint ai_migration_workspaces_expiration check (expires_at > created_at)
);

comment on table public.ai_migration_workspaces is
  'Tenant-scoped, temporary structured staging for multi-file migrations. Raw uploaded bytes are never retained; draft staging expires after 14 days.';

create index if not exists ai_migration_workspaces_department_updated_idx
  on public.ai_migration_workspaces (department_id, updated_at desc);
create index if not exists ai_migration_workspaces_expiration_idx
  on public.ai_migration_workspaces (expires_at)
  where status <> 'completed';

alter table public.ai_migration_workspaces enable row level security;

drop policy if exists "ai_migration_workspaces_select_admins" on public.ai_migration_workspaces;
drop policy if exists "ai_migration_workspaces_insert_admins" on public.ai_migration_workspaces;
drop policy if exists "ai_migration_workspaces_update_admins" on public.ai_migration_workspaces;
drop policy if exists "ai_migration_workspaces_delete_admins" on public.ai_migration_workspaces;

create policy "ai_migration_workspaces_select_admins"
on public.ai_migration_workspaces for select to authenticated
using (public.has_department_permission(department_id, 'administer_department'));

create policy "ai_migration_workspaces_insert_admins"
on public.ai_migration_workspaces for insert to authenticated
with check (
  created_by_user_id = auth.uid()
  and updated_by_user_id = auth.uid()
  and public.has_department_permission(department_id, 'administer_department')
);

create policy "ai_migration_workspaces_update_admins"
on public.ai_migration_workspaces for update to authenticated
using (public.has_department_permission(department_id, 'administer_department'))
with check (
  updated_by_user_id = auth.uid()
  and public.has_department_permission(department_id, 'administer_department')
);

create policy "ai_migration_workspaces_delete_admins"
on public.ai_migration_workspaces for delete to authenticated
using (public.has_department_permission(department_id, 'administer_department'));

create or replace function public.expire_ai_migration_workspaces()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.ai_migration_workspaces
  set status = 'expired', state = jsonb_build_object('version', 1, 'sources', '[]'::jsonb, 'sharedMappings', '[]'::jsonb, 'remediations', '[]'::jsonb, 'mergeRules', '[]'::jsonb), file_count = 0, source_row_count = 0, updated_at = now()
  where expires_at <= now() and status <> 'expired';
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.expire_ai_migration_workspaces() from public, anon, authenticated;
grant execute on function public.expire_ai_migration_workspaces() to service_role;

commit;
