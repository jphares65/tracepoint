-- Normalize the legacy inspection_status enum into the text-based
-- Off-Duty readiness vocabulary used by the current application.

alter table public.off_duty_firearm_requests
  drop constraint if exists off_duty_firearm_requests_inspection_status_check;

alter table public.off_duty_firearm_requests
  alter column inspection_status drop default;

alter table public.off_duty_firearm_requests
  alter column inspection_status type text
  using inspection_status::text;

-- Normalize any legacy enum values before applying the new constraint.
update public.off_duty_firearm_requests
set inspection_status =
  case lower(replace(inspection_status, '_', ' '))
    when 'current' then 'Current'
    when 'due soon' then 'Due Soon'
    when 'overdue' then 'Overdue'
    when 'not inspected' then 'Not Inspected'
    else 'Not Inspected'
  end;

-- Any Off-Duty firearm without an actual inspection record is authoritative
-- "Not Inspected", regardless of its previous cached status.
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
