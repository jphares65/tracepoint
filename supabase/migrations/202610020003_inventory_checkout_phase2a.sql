begin;

-- Checkout is intentionally limited to pooled inventory; Equipment custody remains separate.
alter table public.inventory_transactions drop constraint if exists inventory_transactions_check;
alter table public.inventory_transactions add constraint inventory_transactions_shape_check check (
  (transaction_type='receive' and source_location_id is null and destination_location_id is not null and quantity>0)
  or (transaction_type='adjust' and source_location_id is not null and destination_location_id is null)
  or (transaction_type='transfer' and source_location_id is not null and destination_location_id is not null and source_location_id<>destination_location_id and quantity>0)
  or (transaction_type='checkout' and source_location_id is not null and destination_location_id is null and quantity>0)
  or (transaction_type='checkin' and source_location_id is null and destination_location_id is not null and quantity>0)
);
alter table public.inventory_transactions drop constraint if exists inventory_transactions_transaction_type_check;
alter table public.inventory_transactions add constraint inventory_transactions_transaction_type_check check (transaction_type in ('receive','adjust','transfer','checkout','checkin'));

create table public.inventory_checkouts (
  id uuid primary key default gen_random_uuid(), department_id uuid not null references public.departments(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  inventory_location_id uuid not null references public.inventory_locations(id) on delete restrict,
  recipient_type text not null check (recipient_type in ('officer','unit','vehicle')),
  recipient_user_id uuid references auth.users(id) on delete restrict,
  recipient_unit text, recipient_vehicle_id uuid,
  quantity numeric(14,3) not null check (quantity>0), checked_out_at timestamptz not null default now(), due_at timestamptz,
  closed_at timestamptz, reason text, reference text, checked_out_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((recipient_type='officer' and recipient_user_id is not null and recipient_unit is null and recipient_vehicle_id is null) or (recipient_type='unit' and recipient_user_id is null and nullif(btrim(recipient_unit),'') is not null and recipient_vehicle_id is null) or (recipient_type='vehicle' and recipient_user_id is null and recipient_unit is null and recipient_vehicle_id is not null)),
  check (due_at is null or due_at>checked_out_at)
);
create table public.inventory_checkout_returns (
  id uuid primary key default gen_random_uuid(), department_id uuid not null references public.departments(id) on delete cascade,
  inventory_checkout_id uuid not null references public.inventory_checkouts(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity>0), returned_at timestamptz not null default now(),
  reason text, reference text, returned_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create index inventory_checkouts_department_open_idx on public.inventory_checkouts(department_id,closed_at,due_at);
create index inventory_checkouts_department_item_idx on public.inventory_checkouts(department_id,inventory_item_id,checked_out_at desc);
create index inventory_checkout_returns_checkout_idx on public.inventory_checkout_returns(inventory_checkout_id,returned_at);

alter table public.inventory_checkouts enable row level security;
alter table public.inventory_checkout_returns enable row level security;
create policy inventory_checkouts_read on public.inventory_checkouts for select to authenticated using (public.is_active_department_member(department_id,auth.uid()) and public.has_any_department_permission(department_id,array['view_inventory','manage_inventory','adjust_inventory','administer_department']));
create policy inventory_checkout_returns_read on public.inventory_checkout_returns for select to authenticated using (public.is_active_department_member(department_id,auth.uid()) and public.has_any_department_permission(department_id,array['view_inventory','manage_inventory','adjust_inventory','administer_department']));

create or replace function public.checkout_inventory(p_item_id uuid,p_location_id uuid,p_recipient_type text,p_recipient_user_id uuid default null,p_recipient_unit text default null,p_recipient_vehicle_id uuid default null,p_quantity numeric default null,p_due_at timestamptz default null,p_reason text default null,p_reference text default null)
returns public.inventory_checkouts language plpgsql security definer set search_path=public,auth as $$
declare v_department uuid; v_actor uuid:=auth.uid(); v_item public.inventory_items%rowtype; v_balance numeric(14,3); v_checkout public.inventory_checkouts%rowtype;
begin
  select * into v_item from public.inventory_items where id=p_item_id and is_active for update; v_department:=v_item.department_id;
  if v_department is null or v_actor is null or not public.is_active_department_member(v_department,v_actor) or not public.has_any_department_permission(v_department,array['adjust_inventory','manage_inventory','administer_department']) then raise exception 'inventory checkout permission is required'; end if;
  if v_item.tracking_mode<>'pooled' then raise exception 'only pooled inventory can be checked out'; end if;
  if p_quantity is null or p_quantity<=0 or p_recipient_type not in ('officer','unit','vehicle') or (p_due_at is not null and p_due_at<=now()) then raise exception 'invalid inventory checkout'; end if;
  if p_recipient_type='officer' and not exists(select 1 from public.department_memberships where department_id=v_department and user_id=p_recipient_user_id and is_active) then raise exception 'recipient officer is unavailable'; end if;
  if p_recipient_type='unit' and nullif(btrim(p_recipient_unit),'') is null then raise exception 'recipient unit is required'; end if;
  if p_recipient_type='vehicle' and not exists(select 1 from public.fleet_vehicles where id=p_recipient_vehicle_id and department_id=v_department and status<>'Retired') then raise exception 'recipient vehicle is unavailable'; end if;
  if not exists(select 1 from public.inventory_locations where id=p_location_id and department_id=v_department and is_active) then raise exception 'inventory location is unavailable'; end if;
  insert into public.inventory_balances(department_id,inventory_item_id,inventory_location_id) values(v_department,p_item_id,p_location_id) on conflict do nothing;
  select on_hand_quantity into v_balance from public.inventory_balances where department_id=v_department and inventory_item_id=p_item_id and inventory_location_id=p_location_id for update;
  if v_balance<p_quantity then raise exception 'inventory checkout exceeds available quantity'; end if;
  update public.inventory_balances set on_hand_quantity=v_balance-p_quantity,updated_at=now() where department_id=v_department and inventory_item_id=p_item_id and inventory_location_id=p_location_id;
  insert into public.inventory_checkouts(department_id,inventory_item_id,inventory_location_id,recipient_type,recipient_user_id,recipient_unit,recipient_vehicle_id,quantity,due_at,reason,reference,checked_out_by) values(v_department,p_item_id,p_location_id,p_recipient_type,case when p_recipient_type='officer' then p_recipient_user_id end,case when p_recipient_type='unit' then nullif(btrim(p_recipient_unit),'') end,case when p_recipient_type='vehicle' then p_recipient_vehicle_id end,p_quantity,p_due_at,nullif(btrim(p_reason),''),nullif(btrim(p_reference),''),v_actor) returning * into v_checkout;
  insert into public.inventory_transactions(department_id,inventory_item_id,transaction_type,quantity,source_location_id,reason,reference,actor_user_id) values(v_department,p_item_id,'checkout',p_quantity,p_location_id,nullif(btrim(p_reason),''),nullif(btrim(p_reference),''),v_actor);
  return v_checkout;
end; $$;

create or replace function public.return_inventory_checkout(p_checkout_id uuid,p_quantity numeric,p_reason text default null,p_reference text default null)
returns public.inventory_checkouts language plpgsql security definer set search_path=public,auth as $$
declare v_actor uuid:=auth.uid(); v_checkout public.inventory_checkouts%rowtype; v_returned numeric(14,3); v_balance numeric(14,3);
begin
  select * into v_checkout from public.inventory_checkouts where id=p_checkout_id for update;
  if v_checkout.id is null or v_actor is null or not public.is_active_department_member(v_checkout.department_id,v_actor) or not public.has_any_department_permission(v_checkout.department_id,array['adjust_inventory','manage_inventory','administer_department']) then raise exception 'inventory return permission is required'; end if;
  select coalesce(sum(quantity),0) into v_returned from public.inventory_checkout_returns where inventory_checkout_id=v_checkout.id;
  if p_quantity is null or p_quantity<=0 or v_returned+p_quantity>v_checkout.quantity then raise exception 'inventory return exceeds outstanding quantity'; end if;
  insert into public.inventory_balances(department_id,inventory_item_id,inventory_location_id) values(v_checkout.department_id,v_checkout.inventory_item_id,v_checkout.inventory_location_id) on conflict do nothing;
  select on_hand_quantity into v_balance from public.inventory_balances where department_id=v_checkout.department_id and inventory_item_id=v_checkout.inventory_item_id and inventory_location_id=v_checkout.inventory_location_id for update;
  update public.inventory_balances set on_hand_quantity=v_balance+p_quantity,updated_at=now() where department_id=v_checkout.department_id and inventory_item_id=v_checkout.inventory_item_id and inventory_location_id=v_checkout.inventory_location_id;
  insert into public.inventory_checkout_returns(department_id,inventory_checkout_id,quantity,reason,reference,returned_by) values(v_checkout.department_id,v_checkout.id,p_quantity,nullif(btrim(p_reason),''),nullif(btrim(p_reference),''),v_actor);
  insert into public.inventory_transactions(department_id,inventory_item_id,transaction_type,quantity,destination_location_id,reason,reference,actor_user_id) values(v_checkout.department_id,v_checkout.inventory_item_id,'checkin',p_quantity,v_checkout.inventory_location_id,nullif(btrim(p_reason),''),nullif(btrim(p_reference),''),v_actor);
  if v_returned+p_quantity=v_checkout.quantity then update public.inventory_checkouts set closed_at=now() where id=v_checkout.id returning * into v_checkout; end if;
  return v_checkout;
end; $$;
revoke all on function public.checkout_inventory(uuid,uuid,text,uuid,text,uuid,numeric,timestamptz,text,text),public.return_inventory_checkout(uuid,numeric,text,text) from public,anon;
grant execute on function public.checkout_inventory(uuid,uuid,text,uuid,text,uuid,numeric,timestamptz,text,text),public.return_inventory_checkout(uuid,numeric,text,text) to authenticated;
notify pgrst,'reload schema'; commit;
