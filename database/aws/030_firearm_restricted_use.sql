begin;
create or replace function public.set_firearm_restricted_use(p_firearm_id uuid, p_reason text, p_no_possession_permitted boolean default false, p_duty_only boolean default true, p_daily_return_required boolean default false, p_supervisor_approval_required boolean default false, p_notes text default null) returns uuid language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
declare v_id uuid; v_department_id uuid := tracepoint_auth.department_id(); v_assignment_id uuid; v_officer_id uuid;
begin
  if v_department_id is null or not (public.has_department_permission(v_department_id, 'firearm_custody.manage_restrictions') or public.has_department_permission(v_department_id, 'manage_firearms')) then raise exception 'restriction-management permission required' using errcode='42501'; end if;
  if coalesce(btrim(p_reason), '') = '' or not exists(select 1 from public.firearms where id=p_firearm_id and department_id=v_department_id) then raise exception 'invalid firearm restriction' using errcode='22023'; end if;
  select id, assigned_to_user_id into v_assignment_id, v_officer_id from public.firearm_assignments where firearm_id=p_firearm_id and department_id=v_department_id and returned_at is null;
  if v_assignment_id is null then raise exception 'restricted use requires an active assignment' using errcode='22023'; end if;
  insert into public.firearm_possession_restrictions(department_id, firearm_id, assignment_id, affected_officer_user_id, reason_category, no_possession_permitted, duty_only, daily_return_required, supervisor_approval_required, administrative_notes, created_by_user_id, modified_by_user_id) values(v_department_id,p_firearm_id,v_assignment_id,v_officer_id,'Restricted Use',p_no_possession_permitted,p_duty_only,p_daily_return_required,p_supervisor_approval_required,btrim(p_reason) || coalesce(E'\n' || nullif(btrim(p_notes), ''), ''),tracepoint_auth.subject_id(),tracepoint_auth.subject_id()) returning id into v_id;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, new_value) values(v_department_id,tracepoint_auth.subject_id(),'firearm_restricted_use_enabled','firearm',p_firearm_id,btrim(p_reason),jsonb_build_object('restriction_id',v_id,'assignment_id',v_assignment_id,'no_possession_permitted',p_no_possession_permitted));
  return v_id;
end $$;
revoke all on function public.set_firearm_restricted_use(uuid,text,boolean,boolean,boolean,boolean,text) from public, anon, service_role, tracepoint_runtime;
grant execute on function public.set_firearm_restricted_use(uuid,text,boolean,boolean,boolean,boolean,text) to authenticated;
create or replace function public.clear_firearm_possession_restriction(p_restriction_id uuid, p_reason text default null) returns uuid language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
declare v_restriction public.firearm_possession_restrictions%rowtype; v_department_id uuid := tracepoint_auth.department_id();
begin
  if v_department_id is null or not (public.has_department_permission(v_department_id, 'firearm_custody.manage_restrictions') or public.has_department_permission(v_department_id, 'manage_firearms')) then raise exception 'restriction-management permission required' using errcode='42501'; end if;
  select * into v_restriction from public.firearm_possession_restrictions where id=p_restriction_id and department_id=v_department_id and is_active for update;
  if v_restriction.id is null then raise exception 'active restriction unavailable' using errcode='22023'; end if;
  update public.firearm_possession_restrictions set is_active=false, modified_by_user_id=tracepoint_auth.subject_id(), modified_at=now() where id=v_restriction.id;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, previous_value, new_value) values(v_department_id, tracepoint_auth.subject_id(), 'firearm_possession_restriction_cleared', 'firearm', v_restriction.firearm_id, coalesce(nullif(btrim(p_reason), ''), 'A firearm possession restriction was cleared.'), to_jsonb(v_restriction), jsonb_build_object('restriction_id',v_restriction.id,'is_active',false));
  return v_restriction.id;
end $$;
revoke all on function public.clear_firearm_possession_restriction(uuid,text) from public, anon, service_role, tracepoint_runtime;
grant execute on function public.clear_firearm_possession_restriction(uuid,text) to authenticated;
commit;
