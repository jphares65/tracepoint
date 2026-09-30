begin;

-- Staging may contain the Phase A custody tables and transfer function from
-- 028 while lacking these two public RPCs. Reconcile only those missing,
-- canonical Phase A functions; no custody, assignment, or history rows move.
create or replace function public.create_firearm_storage_location(p_name text, p_description text default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
declare v_id uuid; v_department_id uuid := tracepoint_auth.department_id();
begin
  if v_department_id is null or not public.has_department_permission(v_department_id, 'firearm_custody.manage_storage_locations') then raise exception 'storage-location permission required' using errcode='42501'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'storage location name is required' using errcode='22023'; end if;
  insert into public.firearm_storage_locations(department_id, name, description, created_by_user_id) values(v_department_id, btrim(p_name), nullif(btrim(p_description), ''), tracepoint_auth.subject_id()) returning id into v_id;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, new_value) values(v_department_id, tracepoint_auth.subject_id(), 'firearm_storage_location_created', 'firearm_storage_location', v_id, 'A secure firearm storage location was created.', jsonb_build_object('name',btrim(p_name)));
  return v_id;
end $$;

create or replace function public.create_firearm_possession_restriction(p_firearm_id uuid, p_reason_category text, p_no_possession_permitted boolean, p_duty_only boolean, p_daily_return_required boolean, p_supervisor_approval_required boolean, p_notes text default null, p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
declare v_id uuid; v_department_id uuid := tracepoint_auth.department_id(); v_assignment_id uuid; v_officer_id uuid;
begin
  if v_department_id is null or not public.has_department_permission(v_department_id, 'firearm_custody.manage_restrictions') then raise exception 'restriction-management permission required' using errcode='42501'; end if;
  if coalesce(btrim(p_reason_category), '') = '' or not exists(select 1 from public.firearms where id=p_firearm_id and department_id=v_department_id) then raise exception 'invalid firearm restriction' using errcode='22023'; end if;
  select id, assigned_to_user_id into v_assignment_id, v_officer_id from public.firearm_assignments where firearm_id=p_firearm_id and department_id=v_department_id and returned_at is null;
  insert into public.firearm_possession_restrictions(department_id, firearm_id, assignment_id, affected_officer_user_id, reason_category, no_possession_permitted, duty_only, daily_return_required, supervisor_approval_required, administrative_notes, expires_at, created_by_user_id, modified_by_user_id) values(v_department_id,p_firearm_id,v_assignment_id,v_officer_id,btrim(p_reason_category),p_no_possession_permitted,p_duty_only,p_daily_return_required,p_supervisor_approval_required,nullif(btrim(p_notes),''),p_expires_at,tracepoint_auth.subject_id(),tracepoint_auth.subject_id()) returning id into v_id;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, new_value) values(v_department_id,tracepoint_auth.subject_id(),'firearm_possession_restriction_created','firearm',p_firearm_id,'A firearm possession restriction was created.',jsonb_build_object('restriction_id',v_id,'reason_category',btrim(p_reason_category),'no_possession_permitted',p_no_possession_permitted));
  return v_id;
end $$;

revoke all on function public.create_firearm_storage_location(text,text) from public, anon, service_role, tracepoint_runtime;
revoke all on function public.create_firearm_possession_restriction(uuid,text,boolean,boolean,boolean,boolean,text,timestamptz) from public, anon, service_role, tracepoint_runtime;
grant execute on function public.create_firearm_storage_location(text,text) to authenticated;
grant execute on function public.create_firearm_possession_restriction(uuid,text,boolean,boolean,boolean,boolean,text,timestamptz) to authenticated;

commit;
