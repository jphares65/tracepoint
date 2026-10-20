begin;

-- B8 armory integrity. Separation of duties in the database, so a direct
-- write cannot do what the API refuses:
-- - an off-duty request is never decided by its own officer (ARM-26);
-- - a personal rifle is never reviewed or reinstated by its owner, and its
--   history is written by the database with the change (ARM-29);
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

-- Personal rifle history is written by the database, in the same statement
-- as the change it records, so the rifle and its history commit or roll back
-- together. The actor is the signed-in subject and the statuses come from the
-- row itself. Users cannot insert, change or delete history rows. A history
-- row is written when a rifle is created, when its status changes, and when
-- its owner edits a draft. The route passes its note in workflow_note, which
-- the trigger moves into the history row, so the column is always null.
revoke insert, update, delete on public.personal_rifle_status_history from authenticated;
drop policy if exists personal_rifle_history_insert_actor on public.personal_rifle_status_history;

alter table public.personal_rifles add column if not exists workflow_note text;

create or replace function public.record_personal_rifle_status_history()
returns trigger
language plpgsql
security definer
set search_path = public,tracepoint_auth
as $$
declare
  v_note text;
  v_action text;
  v_metadata jsonb := '{}'::jsonb;
begin
  if tg_when = 'AFTER' then
    insert into public.personal_rifle_status_history (
      department_id, personal_rifle_id, actor_user_id, from_status, to_status, action
    )
    values (
      new.department_id, new.id, tracepoint_auth.subject_id(), null, new.status,
      case when new.status = 'Draft' then 'Draft Created' else 'Owner Submitted' end
    );
    return null;
  end if;

  v_note := nullif(btrim(new.workflow_note), '');
  new.workflow_note := null;
  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.status is not distinct from old.status then
    if new.status = 'Draft'
       and new.owner_user_id = tracepoint_auth.subject_id()
       and to_jsonb(new) - array['updated_at','workflow_note'] is distinct from to_jsonb(old) - array['updated_at','workflow_note'] then
      v_action := 'Owner Saved Draft';
    else
      return new;
    end if;
  else
    v_action := case
      when old.status in ('Draft','Correction Requested') and new.status = 'Draft' then 'Owner Saved Draft'
      when old.status in ('Draft','Correction Requested') then 'Owner Submitted'
      when old.status = 'Pending Armorer Review' and new.status = 'Correction Requested' then 'Correction Requested'
      when old.status = 'Pending Armorer Review' and new.status = 'Armorer Denied' then 'Armorer Denied'
      when old.status = 'Pending Armorer Review' and new.status in ('Pending Chief Approval','Approved') then 'Armorer Approved'
      when old.status = 'Pending Chief Approval' and new.status = 'Approved' then 'Chief Approved'
      when old.status = 'Pending Chief Approval' and new.status = 'Denied' then 'Chief Denied'
      when old.status = 'Approved' and new.status = 'Suspended' then 'Approval Suspended'
      when old.status = 'Suspended' and new.status = 'Approved' then 'Approval Reinstated'
      when new.status = 'Revoked' then 'Approval Revoked'
      else 'Status Changed'
    end;
    if v_action = 'Armorer Approved' then
      v_metadata := jsonb_build_object(
        'checklist', coalesce(new.armorer_checklist, '{}'::jsonb),
        'inspectionDate', new.inspection_date,
        'qualificationVerified', coalesce(new.qualification_verified, false)
      );
    end if;
  end if;

  insert into public.personal_rifle_status_history (
    department_id, personal_rifle_id, actor_user_id, from_status, to_status, action, notes, metadata
  )
  values (
    new.department_id, new.id, tracepoint_auth.subject_id(), old.status, new.status, v_action, v_note, v_metadata
  );
  return new;
end;
$$;

-- Named to run after the other before-update triggers (they fire in name
-- order), so it records the row as it will be stored.
drop trigger if exists personal_rifles_status_history on public.personal_rifles;
create trigger personal_rifles_status_history
before insert or update on public.personal_rifles
for each row execute function public.record_personal_rifle_status_history();
drop trigger if exists personal_rifles_status_history_created on public.personal_rifles;
create trigger personal_rifles_status_history_created
after insert on public.personal_rifles
for each row execute function public.record_personal_rifle_status_history();

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
-- compliance update on a failed inspection. A missing request raises
-- no_data_found (P0002), so the route can answer 404 without reading the
-- request itself.
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
    raise exception 'Off-duty firearm request was not found.'
      using errcode = 'P0002';
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
