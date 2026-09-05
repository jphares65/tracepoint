begin;

-- The server-only Supabase client uses service_role. A clean project does not
-- necessarily inherit the dashboard's default table grants. Give the existing
-- backend role the same CRUD operations used by the application, without
-- changing anonymous/authenticated grants, RLS policies, ownership or BYPASSRLS.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

commit;
