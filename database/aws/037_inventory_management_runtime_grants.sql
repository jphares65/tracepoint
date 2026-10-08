begin;

-- RLS policies authorize Inventory management, but PostgreSQL still requires
-- table DML privileges before those policies are evaluated.
grant insert, update on public.inventory_items, public.inventory_locations to authenticated;

commit;
