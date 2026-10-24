-- Staging catalog shape, 2026-10-24 (read-only capture: task 493901aef40b4088bbbc8e750096a061, classified in
-- TracePointEvidence\sch3-catalog-reconciliation-20261024.md). Applied after a clean 001-068 schema, it reproduces the
-- staging objects that differ from source: the missing 024/027 functions, the Supabase-lineage Phase A variant of 028
-- (policies, transfer function, service_role grants, foreign keys, columns, constraints) and the Supabase-lineage
-- inventory variant. Test fixture only; generated from catalog metadata, it holds no data and no credentials.
begin;
drop function tracepoint_auth.claim_cognito_invite_retry(uuid, text, text, text, text, text, text, text[], uuid[], uuid);
drop function tracepoint_auth.enqueue_notification_email(uuid, uuid, text, text, text, text, text, timestamp with time zone, text, timestamp with time zone);
drop function tracepoint_auth.inspect_cognito_invite_retry(uuid, text, text, text, text, text, text, text[], uuid[]);
alter table public.firearm_custody_events drop constraint "firearm_custody_events_reason_check";
alter table public.firearm_possession_restrictions drop constraint "firearm_possession_restrictions_reason_category_check";
alter table public.firearm_storage_locations drop constraint "firearm_storage_locations_location_kind_check";
alter table public.firearm_storage_locations drop constraint "firearm_storage_locations_name_check";
drop index public.inventory_checkouts_department_item_idx;
drop policy "firearm_current_custody_read" on public.firearm_current_custody;
drop policy "firearm_custody_events_read" on public.firearm_custody_events;
drop policy "firearm_storage_locations_read" on public.firearm_storage_locations;
alter table public.firearm_custody_events add column "approving_user_id" uuid;
alter table public.firearm_custody_events add column "related_checkout_request_id" uuid;
alter table public.firearm_custody_events add column "workflow" text;
alter table public.firearm_custody_events add constraint "firearm_custody_events_approving_user_id_fkey" FOREIGN KEY (approving_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.inventory_items add constraint "inventory_items_id_department_id_key" UNIQUE (id, department_id);
alter table public.inventory_locations add constraint "inventory_locations_id_department_id_key" UNIQUE (id, department_id);
CREATE UNIQUE INDEX firearm_current_custody_storage_slot ON public.firearm_current_custody USING btree (storage_location_id, firearm_id) WHERE (storage_location_id IS NOT NULL);
create policy "firearm_current_custody_member_read" on public.firearm_current_custody as permissive for select to authenticated using (is_department_member(department_id));
create policy "firearm_custody_event_member_read" on public.firearm_custody_events as permissive for select to authenticated using (is_department_member(department_id));
create policy "firearm_restriction_authorized_read" on public.firearm_possession_restrictions as permissive for select to authenticated using (has_any_department_permission(department_id, ARRAY['firearm_custody.manage_restrictions'::text, 'firearm_custody.view_history'::text, 'manage_firearms'::text, 'administer_department'::text]));
create policy "firearm_storage_member_read" on public.firearm_storage_locations as permissive for select to authenticated using (is_department_member(department_id));
alter table public.firearm_current_custody drop constraint "firearm_current_custody_holder_user_id_fkey";
alter table public.firearm_current_custody add constraint "firearm_current_custody_holder_user_id_fkey" FOREIGN KEY (holder_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.firearm_current_custody drop constraint "firearm_current_custody_updated_by_user_id_fkey";
alter table public.firearm_current_custody add constraint "firearm_current_custody_updated_by_user_id_fkey" FOREIGN KEY (updated_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.firearm_custody_events drop constraint "firearm_custody_events_from_holder_user_id_fkey";
alter table public.firearm_custody_events add constraint "firearm_custody_events_from_holder_user_id_fkey" FOREIGN KEY (from_holder_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.firearm_custody_events drop constraint "firearm_custody_events_initiating_user_id_fkey";
alter table public.firearm_custody_events add constraint "firearm_custody_events_initiating_user_id_fkey" FOREIGN KEY (initiating_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.firearm_custody_events drop constraint "firearm_custody_events_to_holder_user_id_fkey";
alter table public.firearm_custody_events add constraint "firearm_custody_events_to_holder_user_id_fkey" FOREIGN KEY (to_holder_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.firearm_possession_restrictions drop constraint "firearm_possession_restrictions_affected_officer_user_id_fkey";
alter table public.firearm_possession_restrictions add constraint "firearm_possession_restrictions_affected_officer_user_id_fkey" FOREIGN KEY (affected_officer_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.firearm_possession_restrictions drop constraint "firearm_possession_restrictions_created_by_user_id_fkey";
alter table public.firearm_possession_restrictions add constraint "firearm_possession_restrictions_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.firearm_possession_restrictions drop constraint "firearm_possession_restrictions_modified_by_user_id_fkey";
alter table public.firearm_possession_restrictions add constraint "firearm_possession_restrictions_modified_by_user_id_fkey" FOREIGN KEY (modified_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.firearm_storage_locations drop constraint "firearm_storage_locations_created_by_user_id_fkey";
alter table public.firearm_storage_locations add constraint "firearm_storage_locations_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.inventory_checkout_returns drop constraint "inventory_checkout_returns_returned_by_fkey";
alter table public.inventory_checkout_returns add constraint "inventory_checkout_returns_returned_by_fkey" FOREIGN KEY (returned_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.inventory_checkouts drop constraint "inventory_checkouts_checked_out_by_fkey";
alter table public.inventory_checkouts add constraint "inventory_checkouts_checked_out_by_fkey" FOREIGN KEY (checked_out_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.inventory_checkouts drop constraint "inventory_checkouts_recipient_user_id_fkey";
alter table public.inventory_checkouts add constraint "inventory_checkouts_recipient_user_id_fkey" FOREIGN KEY (recipient_user_id) REFERENCES profiles(id) ON DELETE RESTRICT;
alter table public.inventory_items drop constraint "inventory_items_created_by_fkey";
alter table public.inventory_items add constraint "inventory_items_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.inventory_items drop constraint "inventory_items_name_check";
alter table public.inventory_items add constraint "inventory_items_name_check" CHECK ((btrim(name) <> ''::text));
alter table public.inventory_items drop constraint "inventory_items_unit_of_measure_check";
alter table public.inventory_items add constraint "inventory_items_unit_of_measure_check" CHECK ((btrim(unit_of_measure) <> ''::text));
alter table public.inventory_items drop constraint "inventory_items_updated_by_fkey";
alter table public.inventory_items add constraint "inventory_items_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.inventory_locations drop constraint "inventory_locations_created_by_fkey";
alter table public.inventory_locations add constraint "inventory_locations_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.inventory_locations drop constraint "inventory_locations_name_check";
alter table public.inventory_locations add constraint "inventory_locations_name_check" CHECK ((btrim(name) <> ''::text));
alter table public.inventory_locations drop constraint "inventory_locations_updated_by_fkey";
alter table public.inventory_locations add constraint "inventory_locations_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.inventory_transactions drop constraint "inventory_transactions_actor_user_id_fkey";
alter table public.inventory_transactions add constraint "inventory_transactions_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES profiles(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION public.transfer_firearm_custody(p_firearm_id uuid, p_to_holder_type text, p_to_holder_user_id uuid, p_to_storage_location_id uuid, p_reason text, p_notes text, p_idempotency_key uuid, p_administrative_correction boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_department_id uuid; v_current public.firearm_current_custody%rowtype; v_assignment_id uuid;
  v_event_id uuid; v_permission text; v_restriction public.firearm_possession_restrictions%rowtype;
begin
  if tracepoint_auth.subject_id() is null then raise exception 'authentication required' using errcode='42501'; end if;
  select department_id into v_department_id from public.firearms where id=p_firearm_id;
  if v_department_id is null or not public.is_department_member(v_department_id) then raise exception 'firearm not found' using errcode='42501'; end if;
  if not exists(select 1 from public.department_features where department_id=v_department_id and feature_code='firearm_custody' and is_enabled) then raise exception 'firearm custody feature is not enabled' using errcode='42501'; end if;
  v_permission := case when p_administrative_correction then 'firearm_custody.override' when p_to_holder_type='OFFICER' then 'firearm_custody.check_out' else 'firearm_custody.check_in' end;
  if not (public.has_department_permission(v_department_id, v_permission) or public.has_department_permission(v_department_id,'manage_firearms')) then raise exception 'custody permission required' using errcode='42501'; end if;
  if coalesce(trim(p_reason),'')='' or p_idempotency_key is null then raise exception 'reason and idempotency key are required' using errcode='22023'; end if;
  select * into v_current from public.firearm_current_custody where firearm_id=p_firearm_id for update;
  if exists(select 1 from public.firearm_custody_events where department_id=v_department_id and idempotency_key=p_idempotency_key) then
    select id into v_event_id from public.firearm_custody_events where department_id=v_department_id and idempotency_key=p_idempotency_key; return v_event_id;
  end if;
  if p_to_holder_type not in ('OFFICER','SECURE_STORAGE') or (p_to_holder_type='OFFICER' and p_to_holder_user_id is null) or (p_to_holder_type='SECURE_STORAGE' and p_to_storage_location_id is null) then raise exception 'invalid custody holder' using errcode='22023'; end if;
  if p_to_holder_type='SECURE_STORAGE' and not exists(select 1 from public.firearm_storage_locations where id=p_to_storage_location_id and department_id=v_department_id and is_active) then raise exception 'invalid storage location' using errcode='22023'; end if;
  select id into v_assignment_id from public.firearm_assignments where firearm_id=p_firearm_id and department_id=v_department_id and returned_at is null;
  select * into v_restriction from public.firearm_possession_restrictions where firearm_id=p_firearm_id and department_id=v_department_id and is_active and effective_start<=now() and (expires_at is null or expires_at>now()) order by effective_start desc limit 1;
  if p_to_holder_type='OFFICER' and v_restriction.no_possession_permitted then raise exception 'active possession restriction prohibits checkout' using errcode='42501'; end if;
  insert into public.firearm_custody_events(department_id,firearm_id,assignment_id,from_holder_type,from_holder_user_id,from_storage_location_id,to_holder_type,to_holder_user_id,to_storage_location_id,initiating_user_id,action_type,reason,restriction_id,notes,idempotency_key)
  values(v_department_id,p_firearm_id,v_assignment_id,v_current.holder_type,v_current.holder_user_id,v_current.storage_location_id,p_to_holder_type,p_to_holder_user_id,p_to_storage_location_id,tracepoint_auth.subject_id(),case when p_administrative_correction then 'ADMINISTRATIVE_CORRECTION' else case when v_current.firearm_id is null then 'INITIALIZE' else 'TRANSFER' end end,p_reason,v_restriction.id,p_notes,p_idempotency_key) returning id into v_event_id;
  insert into public.firearm_current_custody(firearm_id,department_id,assignment_id,holder_type,holder_user_id,storage_location_id,updated_by_user_id)
  values(p_firearm_id,v_department_id,v_assignment_id,p_to_holder_type,p_to_holder_user_id,p_to_storage_location_id,tracepoint_auth.subject_id())
  on conflict(firearm_id) do update set assignment_id=excluded.assignment_id,holder_type=excluded.holder_type,holder_user_id=excluded.holder_user_id,storage_location_id=excluded.storage_location_id,custody_since=now(),updated_by_user_id=excluded.updated_by_user_id,updated_at=now();
  insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,summary,previous_value,new_value,details)
  values(v_department_id,tracepoint_auth.subject_id(),case when p_administrative_correction then 'firearm_custody_corrected' else 'firearm_custody_transferred' end,'firearm',p_firearm_id,p_reason,to_jsonb(v_current),jsonb_build_object('holder_type',p_to_holder_type,'holder_user_id',p_to_holder_user_id,'storage_location_id',p_to_storage_location_id,'assignment_id',v_assignment_id),jsonb_build_object('custody_event_id',v_event_id));
  return v_event_id;
end $function$
;
grant all on table public.firearm_current_custody to service_role;
grant all on table public.firearm_custody_events to service_role;
grant all on table public.firearm_possession_restrictions to service_role;
grant all on table public.firearm_storage_locations to service_role;
commit;
