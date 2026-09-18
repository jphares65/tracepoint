begin;

revoke all on table public.ai_migration_workspaces from anon;
grant select, insert, update, delete on table public.ai_migration_workspaces to authenticated;
grant select, insert, update, delete on table public.ai_migration_workspaces to service_role;

notify pgrst, 'reload schema';

commit;
