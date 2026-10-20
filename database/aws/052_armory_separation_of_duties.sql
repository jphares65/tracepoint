begin;

-- B8 armory integrity. Separation of duties in the database, so a direct
-- write cannot do what the API refuses:
-- - an off-duty request is never decided by its own officer (ARM-26);
-- - a personal rifle is never reviewed or reinstated by its owner (ARM-29);
-- - an ammunition reconciliation is never certified by its submitter, and
--   someone else can now certify it (ARM-23).
-- A failed off-duty inspection marks the request Non-Compliant, an existing
-- compliance value (ARM-28).

create or replace function public.guard_off_duty_request_self_decision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.request_status in ('Approved','Denied','Returned for Correction')
     and new.reviewed_by_user_id is not null
     and new.reviewed_by_user_id = new.officer_user_id
     and (new.request_status is distinct from old.request_status
          or new.reviewed_by_user_id is distinct from old.reviewed_by_user_id) then
    raise exception 'An off-duty firearm request cannot be decided by its own officer.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists off_duty_requests_self_decision_guard on public.off_duty_firearm_requests;
create trigger off_duty_requests_self_decision_guard
before update on public.off_duty_firearm_requests
for each row execute function public.guard_off_duty_request_self_decision();

create or replace function public.guard_personal_rifle_self_review()
returns trigger
language plpgsql
set search_path = public,tracepoint_auth
as $$
begin
  if (new.armorer_reviewed_by is distinct from old.armorer_reviewed_by
        and new.armorer_reviewed_by = new.owner_user_id)
     or (new.chief_reviewed_by is distinct from old.chief_reviewed_by
        and new.chief_reviewed_by = new.owner_user_id)
     or (old.status = 'Suspended' and new.status = 'Approved'
        and new.owner_user_id = tracepoint_auth.subject_id()) then
    raise exception 'A personal rifle cannot be reviewed by its owner.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists personal_rifles_self_review_guard on public.personal_rifles;
create trigger personal_rifles_self_review_guard
before update on public.personal_rifles
for each row execute function public.guard_personal_rifle_self_review();

-- The personal rifle route records each action in personal_rifle_status_history
-- as the signed-in user. The table only granted SELECT (its writes used to go
-- through the Supabase service role), so on AWS every rifle action changed the
-- rifle and then failed with no history row. A user may add a row for their
-- own action, on a rifle of their agency they own or review, matching the
-- rifle's current status.
grant insert on public.personal_rifle_status_history to authenticated;
drop policy if exists personal_rifle_history_insert_actor on public.personal_rifle_status_history;
create policy personal_rifle_history_insert_actor on public.personal_rifle_status_history for insert to authenticated
with check (
  actor_user_id = tracepoint_auth.subject_id()
  and exists (
    select 1 from public.personal_rifles rifle
    where rifle.id = personal_rifle_status_history.personal_rifle_id
      and rifle.department_id = personal_rifle_status_history.department_id
      and rifle.status = personal_rifle_status_history.to_status
      and (
        rifle.owner_user_id = tracepoint_auth.subject_id()
        or public.has_any_department_permission(rifle.department_id, array['manage_inspections','approve_personal_rifles','administer_department'])
      )
  )
);

create or replace function public.guard_ammunition_reconciliation_certifier()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'Certified'
     and old.status is distinct from 'Certified'
     and new.certified_by is not distinct from new.submitted_by then
    raise exception 'An ammunition reconciliation must be certified by someone other than its submitter.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists ammunition_reconciliations_certifier_guard on public.ammunition_reconciliations;
create trigger ammunition_reconciliations_certifier_guard
before update on public.ammunition_reconciliations
for each row execute function public.guard_ammunition_reconciliation_certifier();

-- The update policy only let the submitter write a submitted row, so on AWS
-- the submitter was the only person who could certify it. A certifier may
-- now write the row when they certify it as themselves.
drop policy if exists ammunition_reconciliations_update on public.ammunition_reconciliations;
create policy ammunition_reconciliations_update on public.ammunition_reconciliations for update to authenticated
using (public.has_department_permission(department_id,'manage_firearms'))
with check (
  public.has_department_permission(department_id,'manage_firearms')
  and (certified_by is null or certified_by = tracepoint_auth.subject_id())
  and (
    submitted_by is null
    or submitted_by = tracepoint_auth.subject_id()
    or (status = 'Certified' and certified_by = tracepoint_auth.subject_id())
  )
);

-- Same body as 202608170005 (renamed to _internal by 017), plus the
-- compliance update on a failed inspection.
create or replace function public.record_off_duty_firearm_inspection_internal(
  p_department_id uuid,
  p_request_id uuid,
  p_inspected_by_user_id uuid,
  p_inspection_date date,
  p_result text,
  p_notes text default null
)
returns public.off_duty_firearm_inspections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inspection public.off_duty_firearm_inspections;
begin
  if p_result not in ('Pass', 'Fail') then
    raise exception 'Inspection result must be Pass or Fail.';
  end if;

  if not exists (
    select 1
    from public.off_duty_firearm_requests
    where id = p_request_id
      and department_id = p_department_id
  ) then
    raise exception 'Off-duty firearm request was not found.';
  end if;

  insert into public.off_duty_firearm_inspections (
    department_id,
    request_id,
    inspected_by_user_id,
    inspection_date,
    result,
    notes
  )
  values (
    p_department_id,
    p_request_id,
    p_inspected_by_user_id,
    p_inspection_date,
    p_result,
    p_notes
  )
  returning *
  into v_inspection;

  update public.off_duty_firearm_requests
  set
    inspection_status =
      case
        when p_result = 'Pass' then 'Current'
        else 'Not Inspected'
      end,
    compliance_status =
      case
        when p_result = 'Fail' then 'Non-Compliant'
        else compliance_status
      end,
    inspection_reviewed = true,
    updated_at = now()
  where id = p_request_id
    and department_id = p_department_id;

  return v_inspection;
end;
$$;

revoke all on function public.record_off_duty_firearm_inspection_internal(uuid,uuid,uuid,date,text,text) from public,anon,authenticated,service_role,tracepoint_runtime;

commit;
