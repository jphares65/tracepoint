begin;

-- A vehicle inspection is a safety record. Its audit entry is queued in the same
-- transaction as the inspection (transactional outbox), so a failed audit write
-- can be retried and reconciled instead of reversing the inspection. A committed
-- inspection with a critical defect also takes an Available/Attention vehicle
-- out of service in that transaction, so no later failure can leave it
-- Available. Idempotent.

create table if not exists public.fleet_audit_outbox (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  inspection_id uuid not null unique references public.fleet_vehicle_inspections(id) on delete cascade,
  vehicle_id uuid,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  audit_event_id bigint,
  attempts integer not null default 0,
  last_error text
);

create index if not exists fleet_audit_outbox_pending_idx
  on public.fleet_audit_outbox (department_id, created_at) where delivered_at is null;

alter table public.fleet_audit_outbox enable row level security;
revoke all on public.fleet_audit_outbox from public, anon, authenticated, service_role;

drop policy if exists fleet_audit_outbox_read_managers on public.fleet_audit_outbox;
create policy fleet_audit_outbox_read_managers
on public.fleet_audit_outbox for select to authenticated
using (
  department_id = tracepoint_auth.department_id()
  and public.has_any_department_permission(department_id, array['manage_fleet', 'administer_department'])
);
grant select on public.fleet_audit_outbox to authenticated;

create or replace function public.enqueue_fleet_inspection_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, tracepoint_auth
as $$
declare
  v_rules public.fleet_rules%rowtype;
begin
  insert into public.fleet_audit_outbox(department_id, inspection_id, vehicle_id, actor_user_id, action, entity_type, entity_id, details)
  values (new.department_id, new.id, new.vehicle_id, coalesce(new.inspector_user_id, tracepoint_auth.subject_id()),
    'fleet_vehicle_inspected', 'fleet_vehicle', new.vehicle_id, jsonb_build_object('inspection', to_jsonb(new)))
  on conflict (inspection_id) do nothing;

  if new.critical_defect_count > 0 then
    select * into v_rules from public.fleet_rules where department_id = new.department_id;
    if coalesce(v_rules.status_automation_enabled, true) and coalesce(v_rules.critical_issue_out_of_service, true) then
      update public.fleet_vehicles
      set status = 'Out of Service',
        status_reason = 'Critical defect recorded by a vehicle inspection; review before returning to service.',
        updated_at = now()
      where id = new.vehicle_id and department_id = new.department_id and status in ('Available', 'Attention');
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enqueue_fleet_inspection_audit() from public, anon, authenticated, service_role;

drop trigger if exists fleet_vehicle_inspections_audit_outbox on public.fleet_vehicle_inspections;
create trigger fleet_vehicle_inspections_audit_outbox
after insert on public.fleet_vehicle_inspections
for each row execute function public.enqueue_fleet_inspection_audit();

-- Writes the queued audit entry. Callers have already authorized and locked the row.
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
  select * into v_row from public.fleet_audit_outbox where id = p_outbox_id;
  if v_row.delivered_at is not null then return v_row.audit_event_id; end if;
  v_details := v_row.details || jsonb_build_object(
    'support_mode', tracepoint_auth.is_platform_supporting(v_row.department_id),
    'queued_at', v_row.created_at,
    'work_order_id', (select id from public.fleet_work_orders
      where id = p_work_order_id and department_id = v_row.department_id
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

-- Delivers one inspection's audit entry. Returns the audit event id, or null
-- when the write failed (the attempt is recorded and the entry stays pending).
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
  begin
    return public.fleet_audit_outbox_deliver_internal(v_row.id, v_work_order_id);
  exception when others then
    update public.fleet_audit_outbox set attempts = attempts + 1, last_error = left(sqlerrm, 500) where id = v_row.id;
    return null;
  end;
end;
$$;

-- Reconciles pending entries for the session agency. Fleet managers deliver all
-- of them; other members deliver only entries for their own inspections.
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
