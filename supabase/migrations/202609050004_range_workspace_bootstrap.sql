begin;
-- Required by the existing range and document application routes, but absent
-- from the original bootstrap. No existing tenant workspace is inserted.
create table if not exists public.pilot_range_workspaces (
 department_id uuid primary key references public.departments(id) on delete cascade,
 workspace jsonb not null default '{}'::jsonb,
 updated_by_user_id uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.pilot_range_workspaces enable row level security;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='pilot_range_workspaces' and policyname='range_workspace_member_read') then
  create policy range_workspace_member_read on public.pilot_range_workspaces for select to authenticated using(public.is_department_member(department_id));
 end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.pilot_range_workspaces'::regclass and tgname='pilot_range_workspaces_accountability_audit') then
  create trigger pilot_range_workspaces_accountability_audit after insert or update or delete on public.pilot_range_workspaces for each row execute function public.write_audit_event();
 end if;
end $$;
grant select on public.pilot_range_workspaces to authenticated;
grant select,insert,update,delete on public.pilot_range_workspaces to service_role;
commit;
