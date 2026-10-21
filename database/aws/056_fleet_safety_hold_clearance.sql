begin;

-- A critical safety hold (critical inspection defect or Critical/availability
-- work order) is released only by a later inspection without critical defects
-- or by an audited fleet-manager clearance, never by closing the work order
-- (src/lib/tracepoint/fleet-server.ts findSafetyHold). It applies whatever the
-- agency's automation settings, and in the database too: a write that would
-- leave a held vehicle Available or Attention keeps it Out of Service and is
-- audited, so an older image cannot release it either. The latest clearance
-- is kept on the vehicle; its history is in audit_events. The inspection audit
-- outbox also keeps the defect work order, so reconciliation records it.
-- Idempotent.

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'fleet_vehicles' and column_name = 'safety_hold_cleared_at') then
    alter table public.fleet_vehicles
      add column safety_hold_cleared_at timestamptz,
      add column safety_hold_cleared_by uuid,
      add column safety_hold_clearance_reason text;
    -- Baseline, first application only. A vehicle is marked cleared only on
    -- recorded evidence that its latest critical condition was resolved: a later
    -- inspection without critical defects, and no critical work order still
    -- open. A closed or cancelled work order alone is not evidence. Each
    -- clearance is audited with its evidence.
    with conditions as (
      select v.id, v.department_id, c.source, c.condition_id, c.created_at
      from public.fleet_vehicles v
      cross join lateral (
        select * from (
          select 'inspection' as source, i.id as condition_id, i.created_at from public.fleet_vehicle_inspections i
          where i.department_id = v.department_id and i.vehicle_id = v.id and i.critical_defect_count > 0
          union all
          select 'work_order', w.id, w.created_at from public.fleet_work_orders w
          where w.department_id = v.department_id and w.vehicle_id = v.id and (w.priority = 'Critical' or w.affects_availability)
        ) recorded order by created_at desc limit 1) c
      where not exists (
        select 1 from public.fleet_work_orders w
        where w.department_id = v.department_id and w.vehicle_id = v.id
          and w.status not in ('Completed', 'Cancelled')
          and (w.priority = 'Critical' or w.affects_availability))
    ), evidence as (
      select c.*, e.id as inspection_id, e.created_at as inspected_at
      from conditions c
      cross join lateral (
        select i.id, i.created_at from public.fleet_vehicle_inspections i
        where i.department_id = c.department_id and i.vehicle_id = c.id
          and i.critical_defect_count = 0 and i.created_at > c.created_at
        order by i.created_at desc limit 1) e
    ), cleared as (
      update public.fleet_vehicles v
      set safety_hold_cleared_at = now(),
        safety_hold_clearance_reason = 'Baseline at migration 056: an inspection on ' || to_char(e.inspected_at at time zone 'UTC', 'YYYY-MM-DD')
          || ' recorded no critical defects after the latest critical condition, and no critical work order is open.'
      from evidence e
      where v.id = e.id
      returning v.id, v.department_id, v.safety_hold_clearance_reason, e.source, e.condition_id, e.created_at as condition_at, e.inspection_id, e.inspected_at
    )
    insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, details)
    select department_id, null, 'fleet_safety_hold_cleared', 'fleet_vehicle', id,
      'Safety hold marked cleared by migration 056 (system): a later inspection recorded no critical defects.',
      jsonb_build_object('baseline', '056', 'reason', safety_hold_clearance_reason,
        'hold', jsonb_build_object('since', condition_at, 'source', source, 'record_id', condition_id),
        'evidence', jsonb_build_object('inspection_id', inspection_id, 'inspected_at', inspected_at, 'open_critical_work_orders', 0))
    from cleared;
  end if;
end;
$$;

-- A critical inspection takes an Available/Attention vehicle out of service in
-- its own transaction, whatever the agency's automation settings (as 043
-- otherwise).
create or replace function public.enqueue_fleet_inspection_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, tracepoint_auth
as $$
begin
  insert into public.fleet_audit_outbox(department_id, inspection_id, vehicle_id, actor_user_id, action, entity_type, entity_id, details)
  values (new.department_id, new.id, new.vehicle_id, coalesce(new.inspector_user_id, tracepoint_auth.subject_id()),
    'fleet_vehicle_inspected', 'fleet_vehicle', new.vehicle_id, jsonb_build_object('inspection', to_jsonb(new)))
  on conflict (inspection_id) do nothing;

  if new.critical_defect_count > 0 then
    update public.fleet_vehicles
    set status = 'Out of Service',
      status_reason = 'Critical defect recorded by a vehicle inspection; review before returning to service.',
      updated_at = now()
    where id = new.vehicle_id and department_id = new.department_id and status in ('Available', 'Attention');
  end if;
  return new;
end;
$$;

revoke all on function public.enqueue_fleet_inspection_audit() from public, anon, authenticated, service_role;

-- Only fleet managers and administrators may change the clearance. A new
-- clearance is stamped by the database, must name the subject and a reason, and
-- is refused while a Critical or availability-affecting work order of the
-- vehicle is open; moving it earlier or removing it only restores holds (used
-- to reverse a clearance whose audit entry failed).
create or replace function public.guard_fleet_safety_hold_clearance()
returns trigger
language plpgsql
set search_path = pg_catalog, public, tracepoint_auth
as $$
begin
  if current_user <> 'authenticated'
     or (new.safety_hold_cleared_at is not distinct from old.safety_hold_cleared_at
         and new.safety_hold_cleared_by is not distinct from old.safety_hold_cleared_by
         and new.safety_hold_clearance_reason is not distinct from old.safety_hold_clearance_reason) then
    return new;
  end if;
  if not public.has_any_department_permission(old.department_id, array['manage_fleet', 'administer_department']) then
    raise exception 'safety hold clearance forbidden' using errcode = '42501';
  end if;
  if new.safety_hold_cleared_at is not null
     and (old.safety_hold_cleared_at is null or new.safety_hold_cleared_at > old.safety_hold_cleared_at) then
    if new.safety_hold_cleared_by is distinct from tracepoint_auth.subject_id()
       or nullif(btrim(coalesce(new.safety_hold_clearance_reason, '')), '') is null then
      raise exception 'a safety hold clearance needs the clearing user and a reason' using errcode = '22023';
    end if;
    if exists (select 1 from public.fleet_work_orders w
               where w.department_id = old.department_id and w.vehicle_id = old.id
                 and w.status not in ('Completed', 'Cancelled')
                 and (w.priority = 'Critical' or w.affects_availability)) then
      raise exception 'a safety hold cannot be cleared while a critical work order is open' using errcode = '55000';
    end if;
    new.safety_hold_cleared_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.guard_fleet_safety_hold_clearance() from public, anon, authenticated, service_role;

drop trigger if exists fleet_vehicles_safety_hold_clearance_guard on public.fleet_vehicles;
create trigger fleet_vehicles_safety_hold_clearance_guard
before update on public.fleet_vehicles
for each row execute function public.guard_fleet_safety_hold_clearance();

-- While a vehicle is held (an open Critical or availability-affecting work
-- order, or its latest critical condition not followed by an inspection without
-- critical defects or by a clearance; findSafetyHold), no write leaves it
-- Available or Attention, whoever writes. The status is kept Out of Service, the
-- rest of the write proceeds, and the prevented change is audited. An older
-- image, which releases holds by closing the work order, therefore cannot
-- return a held vehicle to service during an image rollback or a rolling
-- deploy. Definer, as enqueue_fleet_inspection_audit: the hold is read from
-- every record of the vehicle and the audit row is written whatever the
-- writer's own read and audit policies.
create or replace function public.guard_fleet_safety_hold_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, tracepoint_auth
as $$
declare
  v_since timestamptz;
  v_open boolean;
begin
  if coalesce(new.status, '') not in ('Available', 'Attention') then
    return new;
  end if;
  select max(c.created_at) into v_since from (
    select i.created_at from public.fleet_vehicle_inspections i
    where i.department_id = old.department_id and i.vehicle_id = old.id and i.critical_defect_count > 0
    union all
    select w.created_at from public.fleet_work_orders w
    where w.department_id = old.department_id and w.vehicle_id = old.id and (w.priority = 'Critical' or w.affects_availability)) c;
  if v_since is null then
    return new;
  end if;
  v_open := exists (select 1 from public.fleet_work_orders w
    where w.department_id = old.department_id and w.vehicle_id = old.id
      and w.status not in ('Completed', 'Cancelled')
      and (w.priority = 'Critical' or w.affects_availability));
  if not v_open
     and (new.safety_hold_cleared_at > v_since
          or exists (select 1 from public.fleet_vehicle_inspections i
                     where i.department_id = old.department_id and i.vehicle_id = old.id
                       and i.critical_defect_count = 0 and i.created_at > v_since)) then
    return new;
  end if;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, details)
  values (old.department_id, tracepoint_auth.subject_id(), 'fleet_safety_hold_status_kept', 'fleet_vehicle', old.id,
    'Vehicle kept Out of Service: a critical safety hold is active.',
    jsonb_build_object('attempted_status', new.status, 'previous_status', old.status, 'status', 'Out of Service',
      'hold', jsonb_build_object('since', v_since, 'open_critical_work_order', v_open),
      'support_mode', tracepoint_auth.is_platform_supporting(old.department_id)));
  new.status := 'Out of Service';
  return new;
end;
$$;

revoke all on function public.guard_fleet_safety_hold_status() from public, anon, authenticated, service_role;

drop trigger if exists fleet_vehicles_safety_hold_status_guard on public.fleet_vehicles;
create trigger fleet_vehicles_safety_hold_status_guard
before update on public.fleet_vehicles
for each row execute function public.guard_fleet_safety_hold_status();

-- The inspection's defect work order, kept with its queued audit entry.
alter table public.fleet_audit_outbox
  add column if not exists work_order_id uuid references public.fleet_work_orders(id) on delete set null;
-- True when the entry was settled by an audit row the inspection already had.
alter table public.fleet_audit_outbox
  add column if not exists delivered_by_existing_audit boolean not null default false;

-- An older image audits its own inspections (fleet_vehicle_inspected with the
-- inspection in details) while the trigger also queues an entry, for example
-- after an image rollback. Delivery then links that audit row instead of
-- writing a second one. The entry is locked, so a delivery happens once.

create or replace function public.fleet_audit_outbox_deliver_internal(p_outbox_id uuid, p_work_order_id uuid)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, tracepoint_auth
as $$
declare
  v_row public.fleet_audit_outbox%rowtype;
  v_event_id bigint;
  v_details jsonb;
begin
  select * into v_row from public.fleet_audit_outbox where id = p_outbox_id for update;
  if v_row.delivered_at is not null then return v_row.audit_event_id; end if;
  select e.id into v_event_id from public.audit_events e
  where e.department_id = v_row.department_id and e.action = v_row.action
    and e.entity_type = v_row.entity_type and e.entity_id is not distinct from v_row.entity_id
    and e.details -> 'inspection' ->> 'id' = v_row.inspection_id::text
  order by e.id
  limit 1;
  if v_event_id is not null then
    update public.fleet_audit_outbox
    set delivered_at = now(), audit_event_id = v_event_id, delivered_by_existing_audit = true,
      attempts = attempts + 1, last_error = null
    where id = p_outbox_id;
    return v_event_id;
  end if;
  v_details := v_row.details || jsonb_build_object(
    'support_mode', tracepoint_auth.is_platform_supporting(v_row.department_id),
    'queued_at', v_row.created_at,
    'work_order_id', (select id from public.fleet_work_orders
      where id = coalesce(v_row.work_order_id, p_work_order_id) and department_id = v_row.department_id
        and vehicle_id = v_row.vehicle_id and record_type = 'Inspection'))
    || case when v_row.actor_user_id is distinct from tracepoint_auth.subject_id()
         then jsonb_build_object('reconciled_by_user_id', tracepoint_auth.subject_id()) else '{}'::jsonb end;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, details)
  values (v_row.department_id, v_row.actor_user_id, v_row.action, v_row.entity_type, v_row.entity_id, v_details)
  returning id into v_event_id;
  update public.fleet_audit_outbox
  set delivered_at = now(), audit_event_id = v_event_id, attempts = attempts + 1, last_error = null
  where id = p_outbox_id;
  return v_event_id;
end;
$$;

revoke all on function public.fleet_audit_outbox_deliver_internal(uuid, uuid) from public, anon, authenticated, service_role;

-- As in 043, and the work order given by the inspection's own request is kept
-- on the entry before the delivery attempt, so a later reconciliation records
-- it even when this attempt fails. It must be the actor's Inspection work order
-- for the same vehicle, created after the inspection.
create or replace function public.deliver_fleet_audit_outbox(p_inspection_id uuid, p_details jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, tracepoint_auth
as $$
declare
  v_row public.fleet_audit_outbox%rowtype;
  v_work_order_id uuid;
begin
  if tracepoint_auth.subject_id() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into v_row from public.fleet_audit_outbox where inspection_id = p_inspection_id for update;
  if v_row.id is null
     or v_row.department_id is distinct from tracepoint_auth.department_id()
     or not public.is_department_member(v_row.department_id)
     or not (v_row.actor_user_id = tracepoint_auth.subject_id()
       or public.has_any_department_permission(v_row.department_id, array['manage_fleet', 'administer_department'])) then
    raise exception 'fleet audit entry unavailable' using errcode = '42501';
  end if;
  if v_row.delivered_at is not null then return v_row.audit_event_id; end if;
  begin
    v_work_order_id := nullif(p_details ->> 'work_order_id', '')::uuid;
  exception when others then
    v_work_order_id := null;
  end;
  if v_row.work_order_id is null and v_work_order_id is not null then
    update public.fleet_audit_outbox o
    set work_order_id = w.id
    from public.fleet_work_orders w, public.fleet_vehicle_inspections i
    where o.id = v_row.id and i.id = o.inspection_id
      and w.id = v_work_order_id and w.department_id = o.department_id and w.vehicle_id = o.vehicle_id
      and w.record_type = 'Inspection' and w.created_by_user_id is not distinct from o.actor_user_id
      and w.created_at >= i.created_at;
  end if;
  begin
    return public.fleet_audit_outbox_deliver_internal(v_row.id, null);
  exception when others then
    update public.fleet_audit_outbox set attempts = attempts + 1, last_error = left(sqlerrm, 500) where id = v_row.id;
    return null;
  end;
end;
$$;

-- As in 043, except that an entry its own request has not attempted yet (and
-- that is less than five minutes old) is left to that request, so it is not
-- delivered before its defect work order exists.
create or replace function public.deliver_pending_fleet_audit(p_department_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, tracepoint_auth
as $$
declare
  v_manager boolean;
  v_row record;
  v_delivered integer := 0;
  v_failed integer := 0;
begin
  if tracepoint_auth.subject_id() is null
     or p_department_id is distinct from tracepoint_auth.department_id()
     or not public.is_department_member(p_department_id) then
    raise exception 'fleet audit reconciliation forbidden' using errcode = '42501';
  end if;
  v_manager := public.has_any_department_permission(p_department_id, array['manage_fleet', 'administer_department']);
  for v_row in
    select id from public.fleet_audit_outbox
    where department_id = p_department_id and delivered_at is null
      and (v_manager or actor_user_id = tracepoint_auth.subject_id())
      and (attempts > 0 or created_at < now() - interval '5 minutes')
    order by created_at
    limit 100
    for update skip locked
  loop
    begin
      perform public.fleet_audit_outbox_deliver_internal(v_row.id, null);
      v_delivered := v_delivered + 1;
    exception when others then
      update public.fleet_audit_outbox set attempts = attempts + 1, last_error = left(sqlerrm, 500) where id = v_row.id;
      v_failed := v_failed + 1;
    end;
  end loop;
  return jsonb_build_object(
    'delivered', v_delivered,
    'failed', v_failed,
    'pending', (select count(*) from public.fleet_audit_outbox
      where department_id = p_department_id and delivered_at is null
        and (v_manager or actor_user_id = tracepoint_auth.subject_id()))
  );
end;
$$;

revoke all on function public.deliver_fleet_audit_outbox(uuid, jsonb) from public, anon, service_role, tracepoint_runtime;
revoke all on function public.deliver_pending_fleet_audit(uuid) from public, anon, service_role, tracepoint_runtime;
grant execute on function public.deliver_fleet_audit_outbox(uuid, jsonb) to authenticated;
grant execute on function public.deliver_pending_fleet_audit(uuid) to authenticated;

commit;
