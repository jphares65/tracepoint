-- Align a legacy off_duty_firearm_requests table with the current
-- TracePoint Off-Duty Firearms application schema without destroying
-- existing records.

-- -------------------------------------------------------------------
-- 1. Add current application columns that do not exist on legacy tables.
-- -------------------------------------------------------------------

alter table public.off_duty_firearm_requests
  add column if not exists proof_ownership boolean not null default false;

alter table public.off_duty_firearm_requests
  add column if not exists approval_effective_date date;

alter table public.off_duty_firearm_requests
  add column if not exists approval_expiration_date date;

-- Preserve legacy approval dates in the new application columns.
update public.off_duty_firearm_requests
set approval_effective_date = coalesce(
      approval_effective_date,
      approval_date
    )
where approval_date is not null;

update public.off_duty_firearm_requests
set approval_expiration_date = coalesce(
      approval_expiration_date,
      approval_expires_on
    )
where approval_expires_on is not null;

-- Preserve affirmative legacy ownership review information where possible.
update public.off_duty_firearm_requests
set proof_ownership = true
where proof_of_ownership_reviewed = true
  and proof_ownership = false;

-- -------------------------------------------------------------------
-- 2. Convert legacy enum-backed request_status to current text values.
-- -------------------------------------------------------------------

-- These legacy RLS policies reference the request_status enum directly
-- and must be recreated after the column is converted to text.
drop policy if exists off_duty_requests_delete_draft
  on public.off_duty_firearm_requests;

drop policy if exists off_duty_requests_update
  on public.off_duty_firearm_requests;

alter table public.off_duty_firearm_requests
  alter column request_status drop default;

alter table public.off_duty_firearm_requests
  alter column request_status type text
  using (
    case lower(replace(request_status::text, '_', ' '))
      when 'draft' then 'Draft'
      when 'pending command review' then 'Pending Command Review'
      when 'returned for correction' then 'Returned for Correction'
      when 'approved' then 'Approved'
      when 'denied' then 'Denied'
      when 'withdrawn' then 'Withdrawn'
      else 'Pending Command Review'
    end
  );

alter table public.off_duty_firearm_requests
  drop constraint if exists off_duty_firearm_requests_request_status_check;

alter table public.off_duty_firearm_requests
  add constraint off_duty_firearm_requests_request_status_check
  check (
    request_status in (
      'Draft',
      'Pending Command Review',
      'Returned for Correction',
      'Approved',
      'Denied',
      'Withdrawn'
    )
  );

alter table public.off_duty_firearm_requests
  alter column request_status set default 'Pending Command Review';

-- Recreate legacy RLS behavior using the current text-based status values.
create policy off_duty_requests_delete_draft
  on public.off_duty_firearm_requests
  for delete
  to authenticated
  using (
    (
      officer_user_id = auth.uid()
      and request_status = 'Draft'
    )
    or has_department_permission(
      department_id,
      'administer_department'
    )
  );

create policy off_duty_requests_update
  on public.off_duty_firearm_requests
  for update
  to authenticated
  using (
    has_department_permission(
      department_id,
      'review_off_duty_requests'
    )
    or (
      officer_user_id = auth.uid()
      and request_status in (
        'Draft',
        'Returned for Correction'
      )
    )
  )
  with check (
    has_department_permission(
      department_id,
      'review_off_duty_requests'
    )
    or officer_user_id = auth.uid()
  );

-- -------------------------------------------------------------------
-- 3. Convert legacy authorization_status enum to current text values.
-- -------------------------------------------------------------------

alter table public.off_duty_firearm_requests
  alter column authorization_status drop default;

alter table public.off_duty_firearm_requests
  alter column authorization_status type text
  using (
    case lower(replace(authorization_status::text, '_', ' '))
      when 'not authorized' then 'Not Authorized'
      when 'authorized' then 'Authorized'
      when 'expiring soon' then 'Expiring Soon'
      when 'expired' then 'Expired'
      when 'revoked' then 'Revoked'
      else 'Not Authorized'
    end
  );

alter table public.off_duty_firearm_requests
  drop constraint if exists off_duty_firearm_requests_authorization_status_check;

alter table public.off_duty_firearm_requests
  add constraint off_duty_firearm_requests_authorization_status_check
  check (
    authorization_status in (
      'Not Authorized',
      'Authorized',
      'Expiring Soon',
      'Expired',
      'Revoked'
    )
  );

alter table public.off_duty_firearm_requests
  alter column authorization_status set default 'Not Authorized';

-- -------------------------------------------------------------------
-- 4. Convert legacy compliance_status enum to current text values.
-- -------------------------------------------------------------------

alter table public.off_duty_firearm_requests
  alter column compliance_status drop default;

alter table public.off_duty_firearm_requests
  alter column compliance_status type text
  using (
    case lower(replace(compliance_status::text, '_', ' '))
      when 'authorized' then 'Authorized'
      when 'at risk' then 'At Risk'
      when 'non compliant' then 'Non-Compliant'
      else 'At Risk'
    end
  );

alter table public.off_duty_firearm_requests
  drop constraint if exists off_duty_firearm_requests_compliance_status_check;

alter table public.off_duty_firearm_requests
  add constraint off_duty_firearm_requests_compliance_status_check
  check (
    compliance_status in (
      'Authorized',
      'At Risk',
      'Non-Compliant'
    )
  );

alter table public.off_duty_firearm_requests
  alter column compliance_status set default 'At Risk';

-- -------------------------------------------------------------------
-- 5. Normalize inspection_status to final readiness vocabulary.
-- -------------------------------------------------------------------

alter table public.off_duty_firearm_requests
  drop constraint if exists off_duty_firearm_requests_inspection_status_check;

alter table public.off_duty_firearm_requests
  alter column inspection_status drop default;

alter table public.off_duty_firearm_requests
  alter column inspection_status type text
  using inspection_status::text;

update public.off_duty_firearm_requests
set inspection_status =
  case lower(replace(inspection_status, '_', ' '))
    when 'current' then 'Current'
    when 'due soon' then 'Due Soon'
    when 'overdue' then 'Overdue'
    when 'not inspected' then 'Not Inspected'
    else 'Not Inspected'
  end;

-- No actual inspection record = authoritative Not Inspected.
update public.off_duty_firearm_requests r
set inspection_status = 'Not Inspected'
where not exists (
  select 1
  from public.off_duty_firearm_inspections i
  where i.department_id = r.department_id
    and i.request_id = r.id
);

alter table public.off_duty_firearm_requests
  alter column inspection_status set default 'Not Inspected';

alter table public.off_duty_firearm_requests
  add constraint off_duty_firearm_requests_inspection_status_check
  check (
    inspection_status in (
      'Not Inspected',
      'Current',
      'Due Soon',
      'Overdue'
    )
  );

-- -------------------------------------------------------------------
-- 6. Bring timestamps into line with current application expectations.
-- -------------------------------------------------------------------

update public.off_duty_firearm_requests
set submitted_at = coalesce(submitted_at, created_at, now())
where submitted_at is null;

alter table public.off_duty_firearm_requests
  alter column submitted_at set default now();

alter table public.off_duty_firearm_requests
  alter column submitted_at set not null;

-- -------------------------------------------------------------------
-- 7. Ensure expected indexes exist.
-- -------------------------------------------------------------------

create index if not exists off_duty_firearm_requests_department_idx
  on public.off_duty_firearm_requests (department_id);

create index if not exists off_duty_firearm_requests_officer_idx
  on public.off_duty_firearm_requests (
    department_id,
    officer_user_id
  );

create index if not exists off_duty_firearm_requests_status_idx
  on public.off_duty_firearm_requests (
    department_id,
    request_status
  );

-- Ask PostgREST to immediately refresh its schema cache.
notify pgrst, 'reload schema';
