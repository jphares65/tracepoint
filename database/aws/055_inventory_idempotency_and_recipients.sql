begin;

-- One request, one record (UI/UX audit D-65, D-62, D-63, C-07).
--
-- Expand-only. The previous image is the automatic rollback target and keeps
-- calling the 035/036 signatures, so those signatures stay, with the same
-- arguments, defaults, return types and grants. Each now delegates to a new
-- overload that takes p_idempotency_key, so there is still one body per
-- operation. The new overloads have no defaults: a call with the old named
-- arguments can resolve only to the old signature, and a call that names
-- p_idempotency_key only to the new one.
--
-- A replay (the same key from the same actor in the same department) returns
-- the record the first request wrote and changes nothing. A key reused for a
-- different request is refused (23505, as a duplicate key). Keys are serialized by the row lock
-- each operation already takes, and the partial unique indexes are the
-- backstop.

alter table public.inventory_transactions add column if not exists idempotency_key uuid;
alter table public.inventory_checkouts add column if not exists idempotency_key uuid;
alter table public.inventory_checkout_returns add column if not exists idempotency_key uuid;
alter table public.firearm_inspections add column if not exists idempotency_key uuid;
create unique index if not exists inventory_transactions_idempotency_key_idx on public.inventory_transactions(department_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists inventory_checkouts_idempotency_key_idx on public.inventory_checkouts(department_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists inventory_checkout_returns_idempotency_key_idx on public.inventory_checkout_returns(department_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists firearm_inspections_idempotency_key_idx on public.firearm_inspections(department_id, idempotency_key) where idempotency_key is not null;

create or replace function public.record_inventory_transaction(
  p_item_id uuid, p_transaction_type text, p_quantity numeric,
  p_source_location_id uuid, p_destination_location_id uuid,
  p_reason text, p_reference text, p_idempotency_key uuid
) returns public.inventory_transactions language plpgsql security definer set search_path=pg_catalog,public,tracepoint_auth as $$
declare v_department_id uuid; v_actor uuid:=tracepoint_auth.subject_id(); v_transaction public.inventory_transactions%rowtype; v_source numeric(14,3); v_destination numeric(14,3);
begin
  if v_actor is null or tracepoint_auth.department_id() is null then raise exception 'authentication required' using errcode='42501'; end if;
  select department_id into v_department_id from public.inventory_items where id=p_item_id and is_active for update;
  if v_department_id is null or v_department_id is distinct from tracepoint_auth.department_id() or not public.is_department_member(v_department_id) then raise exception 'inventory item unavailable' using errcode='42501'; end if;
  if not (public.has_department_permission(v_department_id,'adjust_inventory') or public.has_department_permission(v_department_id,'manage_inventory') or public.has_department_permission(v_department_id,'administer_department')) then raise exception 'inventory-adjustment permission is required' using errcode='42501'; end if;
  if p_idempotency_key is not null then
    select * into v_transaction from public.inventory_transactions where department_id=v_department_id and idempotency_key=p_idempotency_key;
    if v_transaction.id is not null then
      if v_transaction.actor_user_id is distinct from v_actor or v_transaction.inventory_item_id is distinct from p_item_id
         or v_transaction.transaction_type is distinct from p_transaction_type or v_transaction.quantity is distinct from p_quantity::numeric(14,3)
         or v_transaction.source_location_id is distinct from p_source_location_id or v_transaction.destination_location_id is distinct from p_destination_location_id then
        raise exception 'inventory idempotency key was already used for a different request' using errcode='23505';
      end if;
      return v_transaction;
    end if;
  end if;
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
  insert into public.inventory_transactions(department_id,inventory_item_id,transaction_type,quantity,source_location_id,destination_location_id,reason,reference,actor_user_id,idempotency_key) values(v_department_id,p_item_id,p_transaction_type,p_quantity,p_source_location_id,p_destination_location_id,nullif(btrim(p_reason),''),nullif(btrim(p_reference),''),v_actor,p_idempotency_key) returning * into v_transaction;
  return v_transaction;
end; $$;

create or replace function public.record_inventory_transaction(
  p_item_id uuid, p_transaction_type text, p_quantity numeric,
  p_source_location_id uuid default null, p_destination_location_id uuid default null,
  p_reason text default null, p_reference text default null
) returns public.inventory_transactions language plpgsql security definer set search_path=pg_catalog,public,tracepoint_auth as $$
begin
  return public.record_inventory_transaction(p_item_id,p_transaction_type,p_quantity,p_source_location_id,p_destination_location_id,p_reason,p_reference,null::uuid);
end; $$;

create or replace function public.checkout_inventory(
  p_item_id uuid, p_location_id uuid, p_recipient_type text, p_recipient_user_id uuid, p_recipient_unit text,
  p_recipient_vehicle_id uuid, p_quantity numeric, p_due_at timestamptz, p_reason text, p_reference text,
  p_idempotency_key uuid
) returns public.inventory_checkouts language plpgsql security definer set search_path=pg_catalog,public,tracepoint_auth as $$
declare v_item public.inventory_items%rowtype; v_balance numeric(14,3); v_out public.inventory_checkouts%rowtype; v_actor uuid:=tracepoint_auth.subject_id();
begin
  select * into v_item from public.inventory_items where id=p_item_id and is_active for update;
  if v_item.department_id is null or v_actor is null or v_item.department_id is distinct from tracepoint_auth.department_id() or not public.is_department_member(v_item.department_id) or not(public.has_department_permission(v_item.department_id,'adjust_inventory') or public.has_department_permission(v_item.department_id,'manage_inventory')) then raise exception 'inventory checkout permission is required'; end if;
  if p_idempotency_key is not null then
    select * into v_out from public.inventory_checkouts where department_id=v_item.department_id and idempotency_key=p_idempotency_key;
    if v_out.id is not null then
      if v_out.checked_out_by is distinct from v_actor or v_out.inventory_item_id is distinct from p_item_id or v_out.inventory_location_id is distinct from p_location_id
         or v_out.recipient_type is distinct from p_recipient_type or v_out.quantity is distinct from p_quantity::numeric(14,3)
         or v_out.recipient_user_id is distinct from (case when p_recipient_type='officer' then p_recipient_user_id end)
         or v_out.recipient_unit is distinct from (case when p_recipient_type='unit' then nullif(btrim(p_recipient_unit),'') end)
         or v_out.recipient_vehicle_id is distinct from (case when p_recipient_type='vehicle' then p_recipient_vehicle_id end) then
        raise exception 'inventory idempotency key was already used for a different request' using errcode='23505';
      end if;
      return v_out;
    end if;
  end if;
  if v_item.tracking_mode<>'pooled' or p_quantity is null or p_quantity<=0 or p_recipient_type not in ('officer','unit','vehicle') or (p_due_at is not null and p_due_at<=now()) then raise exception 'invalid inventory checkout'; end if;
  if p_recipient_type='officer' and not exists(select 1 from public.department_memberships where department_id=v_item.department_id and user_id=p_recipient_user_id and is_active) then raise exception 'recipient officer is unavailable'; end if;
  if p_recipient_type='unit' and nullif(btrim(p_recipient_unit),'') is null then raise exception 'recipient unit is required'; end if;
  if p_recipient_type='vehicle' and not exists(select 1 from public.fleet_vehicles where id=p_recipient_vehicle_id and department_id=v_item.department_id and status<>'Retired') then raise exception 'recipient vehicle is unavailable'; end if;
  if not exists(select 1 from public.inventory_locations where id=p_location_id and department_id=v_item.department_id and is_active) then raise exception 'inventory location is unavailable'; end if;
  insert into public.inventory_balances(department_id,inventory_item_id,inventory_location_id) values(v_item.department_id,p_item_id,p_location_id) on conflict do nothing;
  select on_hand_quantity into v_balance from public.inventory_balances where department_id=v_item.department_id and inventory_item_id=p_item_id and inventory_location_id=p_location_id for update;
  if v_balance<p_quantity then raise exception 'inventory checkout exceeds available quantity'; end if;
  update public.inventory_balances set on_hand_quantity=v_balance-p_quantity,updated_at=now() where department_id=v_item.department_id and inventory_item_id=p_item_id and inventory_location_id=p_location_id;
  insert into public.inventory_checkouts(department_id,inventory_item_id,inventory_location_id,recipient_type,recipient_user_id,recipient_unit,recipient_vehicle_id,quantity,due_at,reason,reference,checked_out_by,idempotency_key) values(v_item.department_id,p_item_id,p_location_id,p_recipient_type,case when p_recipient_type='officer' then p_recipient_user_id end,case when p_recipient_type='unit' then nullif(btrim(p_recipient_unit),'') end,case when p_recipient_type='vehicle' then p_recipient_vehicle_id end,p_quantity,p_due_at,nullif(btrim(p_reason),''),nullif(btrim(p_reference),''),v_actor,p_idempotency_key) returning * into v_out;
  insert into public.inventory_transactions(department_id,inventory_item_id,transaction_type,quantity,source_location_id,reason,reference,actor_user_id) values(v_item.department_id,p_item_id,'checkout',p_quantity,p_location_id,nullif(btrim(p_reason),''),nullif(btrim(p_reference),''),v_actor);
  return v_out;
end; $$;

create or replace function public.checkout_inventory(
  p_item_id uuid, p_location_id uuid, p_recipient_type text, p_recipient_user_id uuid default null, p_recipient_unit text default null,
  p_recipient_vehicle_id uuid default null, p_quantity numeric default null, p_due_at timestamptz default null, p_reason text default null, p_reference text default null
) returns public.inventory_checkouts language plpgsql security definer set search_path=pg_catalog,public,tracepoint_auth as $$
begin
  return public.checkout_inventory(p_item_id,p_location_id,p_recipient_type,p_recipient_user_id,p_recipient_unit,p_recipient_vehicle_id,p_quantity,p_due_at,p_reason,p_reference,null::uuid);
end; $$;

create or replace function public.return_inventory_checkout(
  p_checkout_id uuid, p_quantity numeric, p_reason text, p_reference text, p_idempotency_key uuid
) returns public.inventory_checkouts language plpgsql security definer set search_path=pg_catalog,public,tracepoint_auth as $$
declare v public.inventory_checkouts%rowtype; v_replay public.inventory_checkout_returns%rowtype; r numeric(14,3); b numeric(14,3); a uuid:=tracepoint_auth.subject_id();
begin
  select * into v from public.inventory_checkouts where id=p_checkout_id for update;
  if v.id is null or a is null or v.department_id is distinct from tracepoint_auth.department_id() or not public.is_department_member(v.department_id) or not(public.has_department_permission(v.department_id,'adjust_inventory') or public.has_department_permission(v.department_id,'manage_inventory')) then raise exception 'inventory return permission is required'; end if;
  if p_idempotency_key is not null then
    select * into v_replay from public.inventory_checkout_returns where department_id=v.department_id and idempotency_key=p_idempotency_key;
    if v_replay.id is not null then
      if v_replay.returned_by is distinct from a or v_replay.inventory_checkout_id is distinct from v.id or v_replay.quantity is distinct from p_quantity::numeric(14,3) then
        raise exception 'inventory idempotency key was already used for a different request' using errcode='23505';
      end if;
      return v;
    end if;
  end if;
  select coalesce(sum(quantity),0) into r from public.inventory_checkout_returns where inventory_checkout_id=v.id;
  if p_quantity is null or p_quantity<=0 or r+p_quantity>v.quantity then raise exception 'inventory return exceeds outstanding quantity'; end if;
  insert into public.inventory_balances(department_id,inventory_item_id,inventory_location_id) values(v.department_id,v.inventory_item_id,v.inventory_location_id) on conflict do nothing;
  select on_hand_quantity into b from public.inventory_balances where department_id=v.department_id and inventory_item_id=v.inventory_item_id and inventory_location_id=v.inventory_location_id for update;
  update public.inventory_balances set on_hand_quantity=b+p_quantity,updated_at=now() where department_id=v.department_id and inventory_item_id=v.inventory_item_id and inventory_location_id=v.inventory_location_id;
  insert into public.inventory_checkout_returns(department_id,inventory_checkout_id,quantity,reason,reference,returned_by,idempotency_key) values(v.department_id,v.id,p_quantity,nullif(btrim(p_reason),''),nullif(btrim(p_reference),''),a,p_idempotency_key);
  insert into public.inventory_transactions(department_id,inventory_item_id,transaction_type,quantity,destination_location_id,reason,reference,actor_user_id) values(v.department_id,v.inventory_item_id,'checkin',p_quantity,v.inventory_location_id,nullif(btrim(p_reason),''),nullif(btrim(p_reference),''),a);
  if r+p_quantity=v.quantity then update public.inventory_checkouts set closed_at=now() where id=v.id returning * into v; end if;
  return v;
end; $$;

create or replace function public.return_inventory_checkout(
  p_checkout_id uuid, p_quantity numeric, p_reason text default null, p_reference text default null
) returns public.inventory_checkouts language plpgsql security definer set search_path=pg_catalog,public,tracepoint_auth as $$
begin
  return public.return_inventory_checkout(p_checkout_id,p_quantity,p_reason,p_reference,null::uuid);
end; $$;

-- The people and vehicles Inventory can name, for anyone who may see
-- Inventory: the checkout picker (adjusters) and the holder of each
-- outstanding checkout (viewers). Names and the identifying details the
-- picker shows only; no email, phone or other profile data. Inactive members
-- and retired vehicles are listed, flagged, so existing checkouts keep a name.
create or replace function public.inventory_recipient_directory()
returns table (recipient_type text, recipient_id uuid, label text, detail text, is_active boolean)
language sql stable security definer set search_path=pg_catalog,public,tracepoint_auth as $$
  with caller as (
    select tracepoint_auth.department_id() as department_id
    where tracepoint_auth.subject_id() is not null
      and public.is_department_member(tracepoint_auth.department_id())
      and (public.has_department_permission(tracepoint_auth.department_id(),'view_inventory')
        or public.has_department_permission(tracepoint_auth.department_id(),'adjust_inventory')
        or public.has_department_permission(tracepoint_auth.department_id(),'manage_inventory')
        or public.has_department_permission(tracepoint_auth.department_id(),'administer_department'))
  )
  select 'officer'::text, membership.user_id,
    coalesce(nullif(btrim(profile.full_name),''),'Unnamed member'),
    nullif(concat_ws(' · ', nullif(btrim(membership.rank_title),''), nullif(btrim(membership.badge_number),''), nullif(btrim(membership.unit_name),'')),''),
    coalesce(membership.is_active,false)
  from caller
  join public.department_memberships membership on membership.department_id = caller.department_id
  left join public.profiles profile on profile.id = membership.user_id
  union all
  select 'vehicle'::text, vehicle.id,
    coalesce(nullif(btrim(vehicle.unit_number),''),'Unnamed vehicle'),
    nullif(concat_ws(' · ', nullif(btrim(vehicle.make),''), nullif(btrim(vehicle.model),''), nullif(btrim(vehicle.license_plate),'')),''),
    vehicle.status is distinct from 'Retired'
  from caller
  join public.fleet_vehicles vehicle on vehicle.department_id = caller.department_id
$$;

revoke all on function public.record_inventory_transaction(uuid,text,numeric,uuid,uuid,text,text,uuid) from public,anon,service_role,tracepoint_runtime;
revoke all on function public.checkout_inventory(uuid,uuid,text,uuid,text,uuid,numeric,timestamptz,text,text,uuid) from public,anon,service_role,tracepoint_runtime;
revoke all on function public.return_inventory_checkout(uuid,numeric,text,text,uuid) from public,anon,service_role,tracepoint_runtime;
revoke all on function public.inventory_recipient_directory() from public,anon,service_role,tracepoint_runtime;
grant execute on function public.record_inventory_transaction(uuid,text,numeric,uuid,uuid,text,text,uuid) to authenticated;
grant execute on function public.checkout_inventory(uuid,uuid,text,uuid,text,uuid,numeric,timestamptz,text,text,uuid) to authenticated;
grant execute on function public.return_inventory_checkout(uuid,numeric,text,text,uuid) to authenticated;
grant execute on function public.inventory_recipient_directory() to authenticated;

commit;
