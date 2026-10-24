begin;

-- 069: reconcile staging's baseline-recorded objects with their source migrations (SCH-1, SCH-2, SCH-4).
--
-- On 2026-09-30 the runner recorded 001-028 as a baseline without applying them. The SCH-3 catalog reconciliation
-- (2026-10-24, read-only) found three consequences on staging:
--   * 024's tracepoint_auth.enqueue_notification_email was never created, so every notification email is refused (AT-3);
--   * 027's tracepoint_auth.inspect_cognito_invite_retry and claim_cognito_invite_retry were never created;
--   * 028's custody objects are the earlier Supabase-lineage Phase A variant (202609290001): any agency member may
--     read every custody event, transfer_firearm_custody checks neither the active agency nor that the receiving
--     officer is an active member nor that the holder is consistent, service_role holds full DML on the four custody
--     tables (004 revoked it everywhere else), and four CHECK constraints are missing.
--
-- This restores exactly the source definitions of those objects and nothing else. On a schema built from the source
-- files (a clean bootstrap) every statement leaves the catalog unchanged. Nothing later than 028 redefines these
-- functions or policies: 031's restricted custody, 067's custody-assignment guard and Duty Only behaviour, and 068 are
-- untouched. The accepted variants (foreign keys to auth.users, three unused firearm_custody_events columns, the
-- firearm_current_custody_storage_slot index) stay as they are.

-- 1. service_role: the AWS runtime connects as tracepoint_runtime and acts as authenticated; no AWS-native code path
--    uses service_role. Refuse to remove its grants if a runtime role can act as service_role.
do $$
begin
  if exists (
    select 1 from pg_auth_members m
    join pg_roles granted on granted.oid = m.roleid
    join pg_roles member on member.oid = m.member
    where granted.rolname = 'service_role' and member.rolname in ('tracepoint_runtime', 'authenticated', 'anon')
  ) then
    raise exception '069 refused: a runtime role is a member of service_role; review that use before its grants are removed' using errcode = '55000';
  end if;
end $$;

-- The four custody tables are locked once, in a fixed order, before any change: steps 5-7 need these locks anyway,
-- and taking them together means a concurrent reader cannot be caught between them. The runner's lock_timeout turns a
-- long wait into a clean rollback.
lock table public.firearm_storage_locations, public.firearm_current_custody, public.firearm_possession_restrictions, public.firearm_custody_events in access exclusive mode;

-- 2. 024, exactly as written there.
create or replace function tracepoint_auth.enqueue_notification_email(
  p_department_id uuid, p_user_id uuid, p_recipient_email text,
  p_notification_key text, p_fingerprint text, p_subject text,
  p_body_text text, p_scheduled_for timestamptz, p_status text,
  p_updated_at timestamptz
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, tracepoint_auth
as $$
begin
  if session_user <> 'tracepoint_runtime' then
    raise exception 'notification enqueue rejected' using errcode = '42501';
  end if;
  if p_department_id is null or p_user_id is null
    or nullif(btrim(p_recipient_email), '') is null
    or nullif(btrim(p_notification_key), '') is null
    or nullif(btrim(p_fingerprint), '') is null
    or nullif(btrim(p_subject), '') is null
    or nullif(btrim(p_body_text), '') is null
    or p_scheduled_for is null or p_updated_at is null
    or p_status is distinct from 'Pending'
    or not exists (
      select 1 from public.department_memberships m
      join public.profiles p on p.id = m.user_id
      where m.department_id = p_department_id and m.user_id = p_user_id
        and m.is_active = true
        and lower(btrim(p.email)) = lower(btrim(p_recipient_email))
    )
    or not exists (
      select 1 from public.notification_events e
      where e.department_id = p_department_id and e.user_id = p_user_id
        and e.notification_key = p_notification_key
        and e.fingerprint = p_fingerprint
    ) then
    raise exception 'notification enqueue rejected' using errcode = '42501';
  end if;

  insert into public.notification_email_queue (
    department_id, user_id, recipient_email, notification_key, fingerprint,
    subject, body_text, scheduled_for, status, updated_at
  ) values (
    p_department_id, p_user_id, p_recipient_email, p_notification_key,
    p_fingerprint, p_subject, p_body_text, p_scheduled_for, p_status,
    p_updated_at
  ) on conflict (department_id, user_id, notification_key, fingerprint) do nothing;
  return true;
end;
$$;

revoke all on function tracepoint_auth.enqueue_notification_email(
  uuid, uuid, text, text, text, text, text, timestamptz, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function tracepoint_auth.enqueue_notification_email(
  uuid, uuid, text, text, text, text, text, timestamptz, text, timestamptz
) to tracepoint_runtime;

-- 3. 027, exactly as written there.
create or replace function tracepoint_auth.inspect_cognito_invite_retry(
  p_department_id uuid, p_email text, p_full_name text,
  p_badge_number text, p_rank_title text, p_unit_name text,
  p_employee_number text, p_role_codes text[], p_group_ids uuid[]
) returns table(user_id uuid, operation_id uuid, provider_username text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user_id uuid;
  v_op public.authentication_lifecycle_operations%rowtype;
  v_email text := lower(btrim(p_email));
begin
  if session_user <> 'tracepoint_runtime'
     or tracepoint_auth.subject_id() is null
     or current_setting('tracepoint.department_id', true) is distinct from p_department_id::text
     or not (public.has_department_permission(p_department_id, 'manage_users')
             or public.has_department_permission(p_department_id, 'administer_department')) then
    raise exception 'invite retry forbidden' using errcode = '42501';
  end if;
  if v_email is null or v_email = '' or nullif(btrim(p_full_name), '') is null
     or coalesce(cardinality(p_role_codes), 0) = 0 then
    raise exception 'invite retry invalid' using errcode = '22023';
  end if;
  if 'administrator' = any(p_role_codes)
     and not public.has_department_permission(p_department_id, 'administer_department') then
    raise exception 'administrator assignment forbidden' using errcode = '42501';
  end if;

  if (select count(*) from public.profiles where lower(btrim(email)) = v_email) = 0 then
    if (select count(*) from auth.users where lower(btrim(email)) = v_email) <> 0 then
      raise exception 'invite retry identity ambiguous' using errcode = '21000';
    end if;
    return;
  end if;
  if (select count(*) from public.profiles where lower(btrim(email)) = v_email) <> 1
     or (select count(*) from auth.users where lower(btrim(email)) = v_email) <> 1 then
    raise exception 'invite retry identity ambiguous' using errcode = '21000';
  end if;
  select p.id into v_user_id from public.profiles p
    where lower(btrim(p.email)) = v_email;
  if not exists (
      select 1 from public.profiles p join auth.users a on a.id = p.id
      where p.id = v_user_id and p.full_name = btrim(p_full_name)
        and lower(btrim(a.email)) = v_email
        and a.raw_user_meta_data->>'identity_provider' = 'cognito'
    )
    or (select count(*) from public.department_memberships m where m.user_id = v_user_id) <> 1
    or not exists (
      select 1 from public.department_memberships m
      where m.user_id = v_user_id and m.department_id = p_department_id
        and m.is_active and m.deactivated_at is null
        and m.activation_status = 'pending_activation'
        and m.badge_number is not distinct from nullif(btrim(p_badge_number), '')
        and m.rank_title is not distinct from nullif(btrim(p_rank_title), '')
        and m.unit_name is not distinct from nullif(btrim(p_unit_name), '')
        and m.employee_number is not distinct from nullif(btrim(p_employee_number), '')
    )
    or (select array_agg(r.role_code order by r.role_code)
        from public.department_membership_roles r
        where r.user_id = v_user_id and r.department_id = p_department_id)
       is distinct from
       (select array_agg(code order by code) from unnest(p_role_codes) code)
    or (select array_agg(g.group_id order by g.group_id)
        from public.department_group_members g
        where g.user_id = v_user_id and g.department_id = p_department_id)
       is distinct from
       (select array_agg(id order by id) from unnest(coalesce(p_group_ids, array[]::uuid[])) id)
    or exists (select 1 from public.authentication_identity_links l where l.tracepoint_user_id = v_user_id)
    or exists (select 1 from public.user_activation_tokens t where t.user_id = v_user_id)
    or exists (select 1 from public.authentication_identity_events e where e.tracepoint_user_id = v_user_id)
  then
    raise exception 'invite retry identity mismatch' using errcode = '42501';
  end if;

  if (select count(*) from public.authentication_lifecycle_operations o
      where o.tracepoint_user_id = v_user_id) <> 1 then
    raise exception 'invite retry lifecycle ambiguous' using errcode = '21000';
  end if;
  select * into v_op from public.authentication_lifecycle_operations o
    where o.tracepoint_user_id = v_user_id;
  if v_op.operation_kind is distinct from 'invite' or v_op.department_id is distinct from p_department_id
     or v_op.actor_user_id is distinct from tracepoint_auth.subject_id()
     or v_op.state is distinct from 'compensation_required'
     or v_op.safe_error_code is distinct from 'provider_create_failed'
     or v_op.provider_subject is not null
     or v_op.provider_username is null
     or v_op.provider_username !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_op.attempts >= 100 then
    raise exception 'invite retry lifecycle mismatch' using errcode = '42501';
  end if;
  return query select v_user_id, v_op.id, v_op.provider_username;
end;
$$;

create or replace function tracepoint_auth.claim_cognito_invite_retry(
  p_department_id uuid, p_email text, p_full_name text,
  p_badge_number text, p_rank_title text, p_unit_name text,
  p_employee_number text, p_role_codes text[], p_group_ids uuid[],
  p_operation_id uuid
) returns table(user_id uuid, operation_id uuid, provider_username text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_user_id uuid; v_operation_id uuid; v_provider_username text;
begin
  perform 1 from public.authentication_lifecycle_operations o
    where o.id = p_operation_id for update;
  select i.user_id, i.operation_id, i.provider_username
    into v_user_id, v_operation_id, v_provider_username
  from tracepoint_auth.inspect_cognito_invite_retry(
    p_department_id, p_email, p_full_name, p_badge_number, p_rank_title,
    p_unit_name, p_employee_number, p_role_codes, p_group_ids
  ) i;
  if v_operation_id is distinct from p_operation_id then
    raise exception 'invite retry claim mismatch' using errcode = '42501';
  end if;
  update public.authentication_lifecycle_operations o
    set state = 'prepared', safe_error_code = null, attempts = attempts + 1,
        updated_at = now()
    where o.id = p_operation_id and o.state = 'compensation_required'
      and o.safe_error_code = 'provider_create_failed';
  if not found then raise exception 'invite retry claim lost' using errcode = '40001'; end if;
  return query select v_user_id, v_operation_id, v_provider_username;
end;
$$;

revoke all on function tracepoint_auth.inspect_cognito_invite_retry(uuid,text,text,text,text,text,text,text[],uuid[])
  from public, anon, service_role;
revoke all on function tracepoint_auth.claim_cognito_invite_retry(uuid,text,text,text,text,text,text,text[],uuid[],uuid)
  from public, anon, service_role;
grant execute on function tracepoint_auth.inspect_cognito_invite_retry(uuid,text,text,text,text,text,text,text[],uuid[])
  to authenticated;
grant execute on function tracepoint_auth.claim_cognito_invite_retry(uuid,text,text,text,text,text,text,text[],uuid[],uuid)
  to authenticated;

-- 4. 028's transfer_firearm_custody, exactly as written there; same signature, so callers are kept. It requires the
--    firearm's agency to be the caller's active agency, the receiving officer to be an active member, and exactly one
--    holder. The Phase A variant's department_features gate, which 028 never had, goes. The route maps these refusals
--    by 028's messages (custodyTransferFailure).
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

-- 5. Custody RLS as 028 defined it. Custody history needs firearm_custody.view_history or manage_firearms; the variant
--    let every member read it. The variant's extra restriction policy only widened 031's. The two member-read
--    policies that already carry 028's logic take 028's names.
drop policy if exists firearm_custody_event_member_read on public.firearm_custody_events;
drop policy if exists firearm_restriction_authorized_read on public.firearm_possession_restrictions;
do $$
declare v_pair record;
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'firearm_custody_events' and policyname = 'firearm_custody_events_read') then
    create policy firearm_custody_events_read on public.firearm_custody_events for select to authenticated
      using (public.has_department_permission(department_id, 'firearm_custody.view_history') or public.has_department_permission(department_id, 'manage_firearms'));
  end if;
  for v_pair in select * from (values
    ('firearm_current_custody', 'firearm_current_custody_member_read', 'firearm_current_custody_read'),
    ('firearm_storage_locations', 'firearm_storage_member_read', 'firearm_storage_locations_read')
  ) as pairs(relation, variant, source)
  loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = v_pair.relation and policyname = v_pair.variant) then
      if exists (select 1 from pg_policies where schemaname = 'public' and tablename = v_pair.relation and policyname = v_pair.source) then
        execute format('drop policy %I on public.%I', v_pair.variant, v_pair.relation);
      else
        execute format('alter policy %I on public.%I rename to %I', v_pair.variant, v_pair.relation, v_pair.source);
      end if;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = v_pair.relation and policyname = v_pair.source) then
      execute format('create policy %I on public.%I for select to authenticated using (public.is_department_member(department_id))', v_pair.source, v_pair.relation);
    end if;
  end loop;
end $$;

-- 6. Table privileges as 028 granted them: authenticated may read; service_role has nothing (004).
revoke all on public.firearm_storage_locations, public.firearm_current_custody, public.firearm_possession_restrictions, public.firearm_custody_events from service_role;
grant select on public.firearm_storage_locations, public.firearm_current_custody, public.firearm_possession_restrictions, public.firearm_custody_events to authenticated;

-- 7. 028's four CHECK constraints. Existing rows are counted first, under the lock taken above, which keeps new rows
--    out until commit. Any violation stops the whole migration with the counts; no row is changed.
do $$
declare v_check record; v_count bigint; v_refusals text[] := '{}';
begin
  for v_check in select * from (values
    ('firearm_storage_locations', 'firearm_storage_locations_name_check', $c$btrim(name) <> ''$c$),
    ('firearm_storage_locations', 'firearm_storage_locations_location_kind_check', $c$location_kind = 'secure_storage'$c$),
    ('firearm_possession_restrictions', 'firearm_possession_restrictions_reason_category_check', $c$btrim(reason_category) <> ''$c$),
    ('firearm_custody_events', 'firearm_custody_events_reason_check', $c$btrim(reason) <> ''$c$)
  ) as checks(relation, name, expression)
  loop
    if exists (select 1 from pg_constraint where conname = v_check.name and conrelid = format('public.%I', v_check.relation)::regclass) then continue; end if;
    execute format('select count(*) from public.%I where not (%s)', v_check.relation, v_check.expression) into v_count;
    if v_count > 0 then
      v_refusals := v_refusals || format('%s rows of public.%s violate %s', v_count, v_check.relation, v_check.name);
    else
      execute format('alter table public.%I add constraint %I check (%s)', v_check.relation, v_check.name, v_check.expression);
    end if;
  end loop;
  if cardinality(v_refusals) > 0 then
    raise exception '069 refused: % (no rows were changed; correct them under review, then apply again)', array_to_string(v_refusals, '; ') using errcode = '23514';
  end if;
end $$;

-- 8. The end state, checked before commit: exactly 028/031's read policies, no service_role table privilege, the three
--    restored functions, 028's transfer function and the four validated CHECKs. Anything else rolls the whole migration back.
do $$
declare v_policies text;
begin
  select string_agg(tablename || '.' || policyname, ',' order by tablename, policyname) into v_policies
  from pg_policies where schemaname = 'public'
    and tablename in ('firearm_storage_locations', 'firearm_current_custody', 'firearm_possession_restrictions', 'firearm_custody_events');
  if v_policies is distinct from 'firearm_current_custody.firearm_current_custody_read,firearm_custody_events.firearm_custody_events_read,firearm_possession_restrictions.firearm_possession_restrictions_read,firearm_storage_locations.firearm_storage_locations_read' then
    raise exception '069 refused: unexpected custody policies after reconciliation (%)', v_policies using errcode = '55000';
  end if;
  if exists (
    select 1 from unnest(array['public.firearm_storage_locations', 'public.firearm_current_custody', 'public.firearm_possession_restrictions', 'public.firearm_custody_events']) t,
      unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    where has_table_privilege('service_role', t, p)
  ) then
    raise exception '069 refused: service_role still holds a custody table privilege' using errcode = '55000';
  end if;
  if to_regprocedure('tracepoint_auth.enqueue_notification_email(uuid,uuid,text,text,text,text,text,timestamptz,text,timestamptz)') is null
    or to_regprocedure('tracepoint_auth.inspect_cognito_invite_retry(uuid,text,text,text,text,text,text,text[],uuid[])') is null
    or to_regprocedure('tracepoint_auth.claim_cognito_invite_retry(uuid,text,text,text,text,text,text,text[],uuid[],uuid)') is null
    or position('v_department_id is distinct from tracepoint_auth.department_id()' in
      (select prosrc from pg_proc where oid = 'public.transfer_firearm_custody(uuid,text,uuid,uuid,text,text,uuid,boolean)'::regprocedure)) = 0
    or (select count(*) from pg_constraint where convalidated and conname in ('firearm_storage_locations_name_check', 'firearm_storage_locations_location_kind_check',
      'firearm_possession_restrictions_reason_category_check', 'firearm_custody_events_reason_check')) <> 4 then
    raise exception '069 refused: a restored definition is missing after reconciliation' using errcode = '55000';
  end if;
end $$;

commit;
