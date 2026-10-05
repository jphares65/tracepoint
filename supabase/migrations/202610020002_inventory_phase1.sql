begin;

-- Inventory is intentionally separate from individually accountable Equipment.
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  category text not null default 'General',
  description text,
  tracking_mode text not null check (tracking_mode in ('pooled', 'consumable')),
  unit_of_measure text not null default 'each' check (length(btrim(unit_of_measure)) > 0),
  sku text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name)
);

create table public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  description text,
  target_type text not null default 'agency_location' check (target_type in ('agency_location', 'future_vehicle', 'future_room', 'future_bin')),
  target_reference text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name)
);

create table public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  inventory_location_id uuid not null references public.inventory_locations(id) on delete restrict,
  on_hand_quantity numeric(14,3) not null default 0 check (on_hand_quantity >= 0),
  updated_at timestamptz not null default now(),
  unique (department_id, inventory_item_id, inventory_location_id)
);

create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('receive', 'adjust', 'transfer')),
  quantity numeric(14,3) not null check (quantity <> 0),
  source_location_id uuid references public.inventory_locations(id) on delete restrict,
  destination_location_id uuid references public.inventory_locations(id) on delete restrict,
  reason text,
  reference text,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((transaction_type = 'receive' and source_location_id is null and destination_location_id is not null and quantity > 0)
      or (transaction_type = 'adjust' and source_location_id is not null and destination_location_id is null)
      or (transaction_type = 'transfer' and source_location_id is not null and destination_location_id is not null and source_location_id <> destination_location_id and quantity > 0))
);

create index inventory_items_department_active_idx on public.inventory_items(department_id, is_active, name);
create index inventory_locations_department_active_idx on public.inventory_locations(department_id, is_active, name);
create index inventory_balances_department_location_idx on public.inventory_balances(department_id, inventory_location_id, inventory_item_id);
create index inventory_transactions_department_item_created_idx on public.inventory_transactions(department_id, inventory_item_id, created_at desc);

create or replace function public.set_inventory_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger inventory_items_updated_at before update on public.inventory_items for each row execute function public.set_inventory_updated_at();
create trigger inventory_locations_updated_at before update on public.inventory_locations for each row execute function public.set_inventory_updated_at();

-- The only balance writer. Row locking and the nonnegative check make each change atomic.
create or replace function public.record_inventory_transaction(
  p_item_id uuid, p_transaction_type text, p_quantity numeric,
  p_source_location_id uuid default null, p_destination_location_id uuid default null,
  p_reason text default null, p_reference text default null
) returns public.inventory_transactions language plpgsql security definer set search_path = public, auth as $$
declare
  v_department_id uuid; v_actor uuid := auth.uid(); v_transaction public.inventory_transactions;
  v_source numeric(14,3); v_destination numeric(14,3);
begin
  -- Serialize movements for a single item before touching one or two balances.
  -- This avoids lost updates and opposite-direction transfer deadlocks.
  select department_id into v_department_id from public.inventory_items where id = p_item_id and is_active for update;
  if v_department_id is null then raise exception 'Inventory item was not found or is inactive'; end if;
  if not public.has_any_department_permission(v_department_id, array['adjust_inventory', 'manage_inventory', 'administer_department']) then raise exception 'Inventory-adjustment permission is required'; end if;
  if p_transaction_type not in ('receive', 'adjust', 'transfer') or p_quantity = 0 then raise exception 'Invalid inventory transaction'; end if;
  if p_transaction_type = 'receive' and (p_quantity <= 0 or p_destination_location_id is null or p_source_location_id is not null) then raise exception 'Receive requires a positive quantity and destination'; end if;
  if p_transaction_type = 'adjust' and (p_source_location_id is null or p_destination_location_id is not null) then raise exception 'Adjust requires one location'; end if;
  if p_transaction_type = 'transfer' and (p_quantity <= 0 or p_source_location_id is null or p_destination_location_id is null or p_source_location_id = p_destination_location_id) then raise exception 'Transfer requires different source and destination locations'; end if;
  if exists (select 1 from public.inventory_locations where id in (coalesce(p_source_location_id, p_destination_location_id), p_destination_location_id) and department_id <> v_department_id) then raise exception 'Inventory locations must belong to this agency'; end if;
  if p_source_location_id is not null and not exists (select 1 from public.inventory_locations where id = p_source_location_id and department_id = v_department_id and is_active) then raise exception 'Source location was not found or is inactive'; end if;
  if p_destination_location_id is not null and not exists (select 1 from public.inventory_locations where id = p_destination_location_id and department_id = v_department_id and is_active) then raise exception 'Destination location was not found or is inactive'; end if;
  if p_source_location_id is not null then
    insert into public.inventory_balances(department_id, inventory_item_id, inventory_location_id) values (v_department_id, p_item_id, p_source_location_id) on conflict do nothing;
    select on_hand_quantity into v_source from public.inventory_balances where department_id=v_department_id and inventory_item_id=p_item_id and inventory_location_id=p_source_location_id for update;
    if v_source + case when p_transaction_type='adjust' then p_quantity else -p_quantity end < 0 then raise exception 'Inventory cannot fall below zero'; end if;
    update public.inventory_balances set on_hand_quantity = v_source + case when p_transaction_type='adjust' then p_quantity else -p_quantity end, updated_at=now() where department_id=v_department_id and inventory_item_id=p_item_id and inventory_location_id=p_source_location_id;
  end if;
  if p_destination_location_id is not null then
    insert into public.inventory_balances(department_id, inventory_item_id, inventory_location_id, on_hand_quantity) values (v_department_id, p_item_id, p_destination_location_id, 0) on conflict do nothing;
    select on_hand_quantity into v_destination from public.inventory_balances where department_id=v_department_id and inventory_item_id=p_item_id and inventory_location_id=p_destination_location_id for update;
    update public.inventory_balances set on_hand_quantity = v_destination + p_quantity, updated_at=now() where department_id=v_department_id and inventory_item_id=p_item_id and inventory_location_id=p_destination_location_id;
  end if;
  insert into public.inventory_transactions(department_id,inventory_item_id,transaction_type,quantity,source_location_id,destination_location_id,reason,reference,actor_user_id)
  values(v_department_id,p_item_id,p_transaction_type,p_quantity,p_source_location_id,p_destination_location_id,nullif(btrim(p_reason),''),nullif(btrim(p_reference),''),v_actor) returning * into v_transaction;
  return v_transaction;
end $$;
revoke all on function public.record_inventory_transaction(uuid,text,numeric,uuid,uuid,text,text) from public, anon;
grant execute on function public.record_inventory_transaction(uuid,text,numeric,uuid,uuid,text,text) to authenticated;

alter table public.inventory_items enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.inventory_transactions enable row level security;
create policy inventory_items_read on public.inventory_items for select to authenticated using (public.is_active_department_member(department_id, auth.uid()) and public.has_any_department_permission(department_id, array['view_inventory','manage_inventory','adjust_inventory','administer_department']));
create policy inventory_items_manage on public.inventory_items for all to authenticated using (public.has_any_department_permission(department_id, array['manage_inventory','administer_department'])) with check (public.has_any_department_permission(department_id, array['manage_inventory','administer_department']));
create policy inventory_locations_read on public.inventory_locations for select to authenticated using (public.is_active_department_member(department_id, auth.uid()) and public.has_any_department_permission(department_id, array['view_inventory','manage_inventory','adjust_inventory','administer_department']));
create policy inventory_locations_manage on public.inventory_locations for all to authenticated using (public.has_any_department_permission(department_id, array['manage_inventory','administer_department'])) with check (public.has_any_department_permission(department_id, array['manage_inventory','administer_department']));
create policy inventory_balances_read on public.inventory_balances for select to authenticated using (public.is_active_department_member(department_id, auth.uid()) and public.has_any_department_permission(department_id, array['view_inventory','manage_inventory','adjust_inventory','administer_department']));
create policy inventory_transactions_read on public.inventory_transactions for select to authenticated using (public.is_active_department_member(department_id, auth.uid()) and public.has_any_department_permission(department_id, array['view_inventory','manage_inventory','adjust_inventory','administer_department']));

insert into public.permissions(code,display_name,description) values
  ('view_inventory','View Inventory','View pooled and consumable inventory items, locations, balances, and transaction history.'),
  ('manage_inventory','Manage Inventory','Create, edit, and deactivate inventory items and locations.'),
  ('adjust_inventory','Adjust Inventory','Receive, adjust, and transfer inventory through the audited stock ledger.')
on conflict (code) do update set display_name=excluded.display_name, description=excluded.description;

notify pgrst, 'reload schema';
commit;
