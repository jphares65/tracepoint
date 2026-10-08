begin;

-- Phase 1 Inventory remains distinct from serialized Equipment assets.
insert into public.permissions(code, display_name, description) values
  ('view_inventory', 'View Inventory', 'View pooled and consumable inventory items, locations, balances, and transaction history.'),
  ('manage_inventory', 'Manage Inventory', 'Create, edit, and deactivate inventory items and locations.'),
  ('adjust_inventory', 'Adjust Inventory', 'Receive, adjust, and transfer inventory through the audited stock ledger.')
on conflict (code) do update set display_name=excluded.display_name, description=excluded.description;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  category text not null default 'General', description text,
  tracking_mode text not null check (tracking_mode in ('pooled', 'consumable')),
  unit_of_measure text not null default 'each' check (btrim(unit_of_measure) <> ''),
  sku text, is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(department_id, name), unique(id, department_id)
);
create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null check (btrim(name) <> ''), description text,
  target_type text not null default 'agency_location' check (target_type in ('agency_location', 'future_vehicle', 'future_room', 'future_bin')),
  target_reference text, is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(department_id, name), unique(id, department_id)
);
create table if not exists public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  inventory_location_id uuid not null references public.inventory_locations(id) on delete restrict,
  on_hand_quantity numeric(14,3) not null default 0 check (on_hand_quantity >= 0),
  updated_at timestamptz not null default now(),
  unique(department_id, inventory_item_id, inventory_location_id)
);
create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('receive', 'adjust', 'transfer')),
  quantity numeric(14,3) not null check (quantity <> 0),
  source_location_id uuid references public.inventory_locations(id) on delete restrict,
  destination_location_id uuid references public.inventory_locations(id) on delete restrict,
  reason text, reference text, actor_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((transaction_type='receive' and source_location_id is null and destination_location_id is not null and quantity>0)
      or (transaction_type='adjust' and source_location_id is not null and destination_location_id is null)
      or (transaction_type='transfer' and source_location_id is not null and destination_location_id is not null and source_location_id<>destination_location_id and quantity>0))
);
create index if not exists inventory_items_department_active_idx on public.inventory_items(department_id,is_active,name);
create index if not exists inventory_locations_department_active_idx on public.inventory_locations(department_id,is_active,name);
create index if not exists inventory_balances_department_location_idx on public.inventory_balances(department_id,inventory_location_id,inventory_item_id);
create index if not exists inventory_transactions_department_item_created_idx on public.inventory_transactions(department_id,inventory_item_id,created_at desc);

create or replace function public.set_inventory_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists inventory_items_updated_at on public.inventory_items;
create trigger inventory_items_updated_at before update on public.inventory_items for each row execute function public.set_inventory_updated_at();
drop trigger if exists inventory_locations_updated_at on public.inventory_locations;
create trigger inventory_locations_updated_at before update on public.inventory_locations for each row execute function public.set_inventory_updated_at();

alter table public.inventory_items enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.inventory_transactions enable row level security;
drop policy if exists inventory_items_read on public.inventory_items;
drop policy if exists inventory_items_manage on public.inventory_items;
drop policy if exists inventory_locations_read on public.inventory_locations;
drop policy if exists inventory_locations_manage on public.inventory_locations;
drop policy if exists inventory_balances_read on public.inventory_balances;
drop policy if exists inventory_transactions_read on public.inventory_transactions;
create policy inventory_items_read on public.inventory_items for select to authenticated using (public.is_department_member(department_id) and (public.has_department_permission(department_id,'view_inventory') or public.has_department_permission(department_id,'manage_inventory') or public.has_department_permission(department_id,'adjust_inventory') or public.has_department_permission(department_id,'administer_department')));
create policy inventory_items_manage on public.inventory_items for all to authenticated using (public.has_department_permission(department_id,'manage_inventory') or public.has_department_permission(department_id,'administer_department')) with check (public.has_department_permission(department_id,'manage_inventory') or public.has_department_permission(department_id,'administer_department'));
create policy inventory_locations_read on public.inventory_locations for select to authenticated using (public.is_department_member(department_id) and (public.has_department_permission(department_id,'view_inventory') or public.has_department_permission(department_id,'manage_inventory') or public.has_department_permission(department_id,'adjust_inventory') or public.has_department_permission(department_id,'administer_department')));
create policy inventory_locations_manage on public.inventory_locations for all to authenticated using (public.has_department_permission(department_id,'manage_inventory') or public.has_department_permission(department_id,'administer_department')) with check (public.has_department_permission(department_id,'manage_inventory') or public.has_department_permission(department_id,'administer_department'));
create policy inventory_balances_read on public.inventory_balances for select to authenticated using (public.is_department_member(department_id) and (public.has_department_permission(department_id,'view_inventory') or public.has_department_permission(department_id,'manage_inventory') or public.has_department_permission(department_id,'adjust_inventory') or public.has_department_permission(department_id,'administer_department')));
create policy inventory_transactions_read on public.inventory_transactions for select to authenticated using (public.is_department_member(department_id) and (public.has_department_permission(department_id,'view_inventory') or public.has_department_permission(department_id,'manage_inventory') or public.has_department_permission(department_id,'adjust_inventory') or public.has_department_permission(department_id,'administer_department')));
grant select on public.inventory_items, public.inventory_locations, public.inventory_balances, public.inventory_transactions to authenticated;

-- The security-definer RPC is the only authenticated balance mutation path.
create or replace function public.record_inventory_transaction(
  p_item_id uuid, p_transaction_type text, p_quantity numeric,
  p_source_location_id uuid default null, p_destination_location_id uuid default null,
  p_reason text default null, p_reference text default null
) returns public.inventory_transactions language plpgsql security definer set search_path=pg_catalog,public,tracepoint_auth as $$
declare v_department_id uuid; v_actor uuid:=tracepoint_auth.subject_id(); v_transaction public.inventory_transactions%rowtype; v_source numeric(14,3); v_destination numeric(14,3);
begin
  if v_actor is null or tracepoint_auth.department_id() is null then raise exception 'authentication required' using errcode='42501'; end if;
  select department_id into v_department_id from public.inventory_items where id=p_item_id and is_active for update;
  if v_department_id is null or v_department_id is distinct from tracepoint_auth.department_id() or not public.is_department_member(v_department_id) then raise exception 'inventory item unavailable' using errcode='42501'; end if;
  if not (public.has_department_permission(v_department_id,'adjust_inventory') or public.has_department_permission(v_department_id,'manage_inventory') or public.has_department_permission(v_department_id,'administer_department')) then raise exception 'inventory-adjustment permission is required' using errcode='42501'; end if;
  if p_transaction_type not in ('receive','adjust','transfer') or p_quantity=0 then raise exception 'invalid inventory transaction' using errcode='22023'; end if;
  if p_transaction_type='receive' and (p_quantity<=0 or p_source_location_id is not null or p_destination_location_id is null) then raise exception 'receive requires a positive quantity and destination' using errcode='22023'; end if;
  if p_transaction_type='adjust' and (p_source_location_id is null or p_destination_location_id is not null) then raise exception 'adjust requires one location' using errcode='22023'; end if;
  if p_transaction_type='transfer' and (p_quantity<=0 or p_source_location_id is null or p_destination_location_id is null or p_source_location_id=p_destination_location_id) then raise exception 'transfer requires different source and destination locations' using errcode='22023'; end if;
  if p_source_location_id is not null and not exists(select 1 from public.inventory_locations where id=p_source_location_id and department_id=v_department_id and is_active) then raise exception 'source location unavailable' using errcode='22023'; end if;
  if p_destination_location_id is not null and not exists(select 1 from public.inventory_locations where id=p_destination_location_id and department_id=v_department_id and is_active) then raise exception 'destination location unavailable' using errcode='22023'; end if;
  if p_source_location_id is not null then
    insert into public.inventory_balances(department_id,inventory_item_id,inventory_location_id) values(v_department_id,p_item_id,p_source_location_id) on conflict do nothing;
    select on_hand_quantity into v_source from public.inventory_balances where department_id=v_department_id and inventory_item_id=p_item_id and inventory_location_id=p_source_location_id for update;
    if v_source + (case when p_transaction_type='adjust' then p_quantity else -p_quantity end) < 0 then raise exception 'inventory cannot fall below zero' using errcode='22003'; end if;
    update public.inventory_balances set on_hand_quantity=v_source+(case when p_transaction_type='adjust' then p_quantity else -p_quantity end),updated_at=now() where department_id=v_department_id and inventory_item_id=p_item_id and inventory_location_id=p_source_location_id;
  end if;
  if p_destination_location_id is not null then
    insert into public.inventory_balances(department_id,inventory_item_id,inventory_location_id) values(v_department_id,p_item_id,p_destination_location_id) on conflict do nothing;
    select on_hand_quantity into v_destination from public.inventory_balances where department_id=v_department_id and inventory_item_id=p_item_id and inventory_location_id=p_destination_location_id for update;
    update public.inventory_balances set on_hand_quantity=v_destination+p_quantity,updated_at=now() where department_id=v_department_id and inventory_item_id=p_item_id and inventory_location_id=p_destination_location_id;
  end if;
  insert into public.inventory_transactions(department_id,inventory_item_id,transaction_type,quantity,source_location_id,destination_location_id,reason,reference,actor_user_id) values(v_department_id,p_item_id,p_transaction_type,p_quantity,p_source_location_id,p_destination_location_id,nullif(btrim(p_reason),''),nullif(btrim(p_reference),''),v_actor) returning * into v_transaction;
  return v_transaction;
 end; $$;
revoke all on function public.record_inventory_transaction(uuid,text,numeric,uuid,uuid,text,text) from public,anon,service_role,tracepoint_runtime;
grant execute on function public.record_inventory_transaction(uuid,text,numeric,uuid,uuid,text,text) to authenticated;
commit;
