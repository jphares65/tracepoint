begin;

-- Phase A records physical possession independently from assignment.  No
-- department feature row is used: the schema and permission catalog are
-- available to every current and future department.
insert into public.permissions(code, display_name, description) values
  ('firearm_custody.check_out', 'Check Out Firearm Custody', 'Transfer a firearm from secure storage to an officer.'),
  ('firearm_custody.check_in', 'Check In Firearm Custody', 'Transfer a firearm from an officer to secure storage.'),
  ('firearm_custody.approve_restricted_checkout', 'Approve Restricted Firearm Checkout', 'Approve a restricted firearm checkout.'),
  ('firearm_custody.manage_restrictions', 'Manage Firearm Possession Restrictions', 'Create and manage firearm possession restrictions.'),
  ('firearm_custody.override', 'Override Firearm Custody', 'Correct firearm custody with a documented administrative reason.'),
  ('firearm_custody.manage_storage_locations', 'Manage Firearm Storage Locations', 'Create and manage secure firearm storage locations.'),
  ('firearm_custody.generate_qr', 'Generate Firearm Custody QR Codes', 'Reserved for a later QR workflow.'),
  ('firearm_custody.view_history', 'View Firearm Custody History', 'View firearm custody and restriction history.')
on conflict (code) do update set display_name = excluded.display_name, description = excluded.description;

create table if not exists public.firearm_storage_locations (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  location_kind text not null default 'secure_storage' check (location_kind = 'secure_storage'),
  description text,
  is_active boolean not null default true,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name), unique (id, department_id)
);

create table if not exists public.firearm_current_custody (
  firearm_id uuid primary key references public.firearms(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  assignment_id uuid references public.firearm_assignments(id) on delete set null,
  holder_type text not null check (holder_type in ('OFFICER', 'SECURE_STORAGE')),
  holder_user_id uuid references public.profiles(id) on delete restrict,
  storage_location_id uuid references public.firearm_storage_locations(id) on delete restrict,
  custody_since timestamptz not null default now(),
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((holder_type = 'OFFICER' and holder_user_id is not null and storage_location_id is null)
      or (holder_type = 'SECURE_STORAGE' and storage_location_id is not null and holder_user_id is null)),
  unique (firearm_id, department_id)
);

create table if not exists public.firearm_possession_restrictions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  firearm_id uuid not null references public.firearms(id) on delete cascade,
  assignment_id uuid references public.firearm_assignments(id) on delete set null,
  affected_officer_user_id uuid references public.profiles(id) on delete set null,
  effective_start timestamptz not null default now(),
  expires_at timestamptz,
  is_active boolean not null default true,
  reason_category text not null check (btrim(reason_category) <> ''),
  no_possession_permitted boolean not null default false,
  duty_only boolean not null default false,
  daily_return_required boolean not null default false,
  supervisor_approval_required boolean not null default false,
  maximum_custody_duration interval,
  administrative_notes text,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  modified_by_user_id uuid references public.profiles(id) on delete set null,
  modified_at timestamptz not null default now(),
  check (expires_at is null or expires_at > effective_start)
);

create table if not exists public.firearm_custody_events (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  firearm_id uuid not null references public.firearms(id) on delete restrict,
  assignment_id uuid references public.firearm_assignments(id) on delete set null,
  from_holder_type text check (from_holder_type in ('OFFICER', 'SECURE_STORAGE')),
  from_holder_user_id uuid references public.profiles(id) on delete restrict,
  from_storage_location_id uuid references public.firearm_storage_locations(id) on delete restrict,
  to_holder_type text not null check (to_holder_type in ('OFFICER', 'SECURE_STORAGE')),
  to_holder_user_id uuid references public.profiles(id) on delete restrict,
  to_storage_location_id uuid references public.firearm_storage_locations(id) on delete restrict,
  initiating_user_id uuid not null references public.profiles(id) on delete restrict,
  action_type text not null check (action_type in ('INITIALIZE', 'TRANSFER', 'ADMINISTRATIVE_CORRECTION')),
  reason text not null check (btrim(reason) <> ''),
  notes text,
  restriction_id uuid references public.firearm_possession_restrictions(id) on delete set null,
  idempotency_key uuid not null,
  occurred_at timestamptz not null default now(),
  unique (department_id, idempotency_key)
);
create index if not exists firearm_custody_events_firearm_time on public.firearm_custody_events(department_id, firearm_id, occurred_at desc);

alter table public.firearm_storage_locations enable row level security;
alter table public.firearm_current_custody enable row level security;
alter table public.firearm_possession_restrictions enable row level security;
alter table public.firearm_custody_events enable row level security;

create policy firearm_storage_locations_read on public.firearm_storage_locations for select to authenticated using (public.is_department_member(department_id));
create policy firearm_current_custody_read on public.firearm_current_custody for select to authenticated using (public.is_department_member(department_id));
create policy firearm_possession_restrictions_read on public.firearm_possession_restrictions for select to authenticated using (public.has_department_permission(department_id, 'firearm_custody.view_history') or public.has_department_permission(department_id, 'firearm_custody.manage_restrictions') or public.has_department_permission(department_id, 'manage_firearms'));
create policy firearm_custody_events_read on public.firearm_custody_events for select to authenticated using (public.has_department_permission(department_id, 'firearm_custody.view_history') or public.has_department_permission(department_id, 'manage_firearms'));
grant select on public.firearm_storage_locations, public.firearm_current_custody, public.firearm_possession_restrictions, public.firearm_custody_events to authenticated;

create or replace function public.transfer_firearm_custody(
  p_firearm_id uuid, p_to_holder_type text, p_to_holder_user_id uuid,
  p_to_storage_location_id uuid, p_reason text, p_notes text, p_idempotency_key uuid,
  p_administrative_correction boolean default false
) returns uuid language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
declare
  v_department_id uuid; v_current public.firearm_current_custody%rowtype; v_assignment_id uuid;
  v_event_id uuid; v_permission text; v_restriction public.firearm_possession_restrictions%rowtype;
begin
  if tracepoint_auth.subject_id() is null then raise exception 'authentication required' using errcode='42501'; end if;
  select department_id into v_department_id from public.firearms where id = p_firearm_id;
  if v_department_id is null or v_department_id is distinct from tracepoint_auth.department_id() or not public.is_department_member(v_department_id) then raise exception 'firearm unavailable' using errcode='42501'; end if;
  v_permission := case when p_administrative_correction then 'firearm_custody.override' when p_to_holder_type = 'OFFICER' then 'firearm_custody.check_out' else 'firearm_custody.check_in' end;
  if not (public.has_department_permission(v_department_id, v_permission) or public.has_department_permission(v_department_id, 'manage_firearms')) then raise exception 'custody permission required' using errcode='42501'; end if;
  if coalesce(btrim(p_reason), '') = '' or p_idempotency_key is null then raise exception 'reason and idempotency key are required' using errcode='22023'; end if;
  if p_to_holder_type not in ('OFFICER', 'SECURE_STORAGE') or (p_to_holder_type = 'OFFICER' and (p_to_holder_user_id is null or p_to_storage_location_id is not null)) or (p_to_holder_type = 'SECURE_STORAGE' and (p_to_storage_location_id is null or p_to_holder_user_id is not null)) then raise exception 'invalid custody holder' using errcode='22023'; end if;
  if exists (select 1 from public.firearm_custody_events where department_id = v_department_id and idempotency_key = p_idempotency_key) then select id into v_event_id from public.firearm_custody_events where department_id = v_department_id and idempotency_key = p_idempotency_key; return v_event_id; end if;
  select * into v_current from public.firearm_current_custody where firearm_id = p_firearm_id for update;
  if p_to_holder_type = 'OFFICER' and not exists (select 1 from public.department_memberships where department_id=v_department_id and user_id=p_to_holder_user_id and is_active) then raise exception 'custody officer unavailable' using errcode='22023'; end if;
  if p_to_holder_type = 'SECURE_STORAGE' and not exists (select 1 from public.firearm_storage_locations where id=p_to_storage_location_id and department_id=v_department_id and is_active) then raise exception 'storage location unavailable' using errcode='22023'; end if;
  select id into v_assignment_id from public.firearm_assignments where department_id=v_department_id and firearm_id=p_firearm_id and returned_at is null;
  select * into v_restriction from public.firearm_possession_restrictions where department_id=v_department_id and firearm_id=p_firearm_id and is_active and effective_start <= now() and (expires_at is null or expires_at > now()) order by effective_start desc limit 1;
  if p_to_holder_type = 'OFFICER' and coalesce(v_restriction.no_possession_permitted, false) then raise exception 'active possession restriction prohibits checkout' using errcode='42501'; end if;
  insert into public.firearm_custody_events(department_id, firearm_id, assignment_id, from_holder_type, from_holder_user_id, from_storage_location_id, to_holder_type, to_holder_user_id, to_storage_location_id, initiating_user_id, action_type, reason, notes, restriction_id, idempotency_key)
  values(v_department_id, p_firearm_id, v_assignment_id, v_current.holder_type, v_current.holder_user_id, v_current.storage_location_id, p_to_holder_type, p_to_holder_user_id, p_to_storage_location_id, tracepoint_auth.subject_id(), case when p_administrative_correction then 'ADMINISTRATIVE_CORRECTION' when v_current.firearm_id is null then 'INITIALIZE' else 'TRANSFER' end, p_reason, p_notes, v_restriction.id, p_idempotency_key) returning id into v_event_id;
  insert into public.firearm_current_custody(firearm_id, department_id, assignment_id, holder_type, holder_user_id, storage_location_id, updated_by_user_id)
  values(p_firearm_id, v_department_id, v_assignment_id, p_to_holder_type, p_to_holder_user_id, p_to_storage_location_id, tracepoint_auth.subject_id())
  on conflict (firearm_id) do update set assignment_id=excluded.assignment_id, holder_type=excluded.holder_type, holder_user_id=excluded.holder_user_id, storage_location_id=excluded.storage_location_id, custody_since=now(), updated_by_user_id=excluded.updated_by_user_id, updated_at=now();
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, previous_value, new_value, details)
  values(v_department_id, tracepoint_auth.subject_id(), case when p_administrative_correction then 'firearm_custody_corrected' else 'firearm_custody_transferred' end, 'firearm', p_firearm_id, p_reason, to_jsonb(v_current), jsonb_build_object('holder_type',p_to_holder_type,'holder_user_id',p_to_holder_user_id,'storage_location_id',p_to_storage_location_id,'assignment_id',v_assignment_id), jsonb_build_object('custody_event_id',v_event_id));
  return v_event_id;
end $$;

revoke all on function public.transfer_firearm_custody(uuid,text,uuid,uuid,text,text,uuid,boolean) from public, anon, service_role, tracepoint_runtime;
grant execute on function public.transfer_firearm_custody(uuid,text,uuid,uuid,text,text,uuid,boolean) to authenticated;

create or replace function public.create_firearm_storage_location(p_name text, p_description text default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
declare v_id uuid; v_department_id uuid := tracepoint_auth.department_id();
begin
  if v_department_id is null or not public.has_department_permission(v_department_id, 'firearm_custody.manage_storage_locations') then
    raise exception 'storage-location permission required' using errcode='42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'storage location name is required' using errcode='22023'; end if;
  insert into public.firearm_storage_locations(department_id, name, description, created_by_user_id)
  values(v_department_id, btrim(p_name), nullif(btrim(p_description), ''), tracepoint_auth.subject_id()) returning id into v_id;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, new_value)
  values(v_department_id, tracepoint_auth.subject_id(), 'firearm_storage_location_created', 'firearm_storage_location', v_id, 'A secure firearm storage location was created.', jsonb_build_object('name',btrim(p_name)));
  return v_id;
end $$;

create or replace function public.create_firearm_possession_restriction(
  p_firearm_id uuid, p_reason_category text, p_no_possession_permitted boolean,
  p_duty_only boolean, p_daily_return_required boolean, p_supervisor_approval_required boolean,
  p_notes text default null, p_expires_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
declare v_id uuid; v_department_id uuid := tracepoint_auth.department_id(); v_assignment_id uuid; v_officer_id uuid;
begin
  if v_department_id is null or not public.has_department_permission(v_department_id, 'firearm_custody.manage_restrictions') then
    raise exception 'restriction-management permission required' using errcode='42501';
  end if;
  if coalesce(btrim(p_reason_category), '') = '' or not exists(select 1 from public.firearms where id=p_firearm_id and department_id=v_department_id) then raise exception 'invalid firearm restriction' using errcode='22023'; end if;
  select id, assigned_to_user_id into v_assignment_id, v_officer_id from public.firearm_assignments where firearm_id=p_firearm_id and department_id=v_department_id and returned_at is null;
  insert into public.firearm_possession_restrictions(department_id, firearm_id, assignment_id, affected_officer_user_id, reason_category, no_possession_permitted, duty_only, daily_return_required, supervisor_approval_required, administrative_notes, expires_at, created_by_user_id, modified_by_user_id)
  values(v_department_id,p_firearm_id,v_assignment_id,v_officer_id,btrim(p_reason_category),p_no_possession_permitted,p_duty_only,p_daily_return_required,p_supervisor_approval_required,nullif(btrim(p_notes),''),p_expires_at,tracepoint_auth.subject_id(),tracepoint_auth.subject_id()) returning id into v_id;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, new_value)
  values(v_department_id,tracepoint_auth.subject_id(),'firearm_possession_restriction_created','firearm',p_firearm_id,'A firearm possession restriction was created.',jsonb_build_object('restriction_id',v_id,'reason_category',btrim(p_reason_category),'no_possession_permitted',p_no_possession_permitted));
  return v_id;
end $$;

revoke all on function public.create_firearm_storage_location(text,text) from public, anon, service_role, tracepoint_runtime;
revoke all on function public.create_firearm_possession_restriction(uuid,text,boolean,boolean,boolean,boolean,text,timestamptz) from public, anon, service_role, tracepoint_runtime;
grant execute on function public.create_firearm_storage_location(text,text) to authenticated;
grant execute on function public.create_firearm_possession_restriction(uuid,text,boolean,boolean,boolean,boolean,text,timestamptz) to authenticated;

-- Assignment availability intentionally ignores physical custody.  An assigned
-- firearm in secure storage remains unavailable until its assignment is closed.
create or replace view public.available_firearms_for_assignment with (security_invoker=true) as
select firearm.* from public.firearms firearm
where firearm.is_active and firearm.condition_status='In Service'
and not exists (select 1 from public.firearm_assignments assignment where assignment.firearm_id=firearm.id and assignment.department_id=firearm.department_id and assignment.returned_at is null);
grant select on public.available_firearms_for_assignment to authenticated;

commit;
