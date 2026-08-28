begin;

alter table public.agency_training_events
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists reopen_reason text;

create or replace function public.close_agency_training_event(
  p_department_id uuid,
  p_event_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.agency_training_events%rowtype;
  certification_type_row public.certification_types%rowtype;
  department_name_value text;
  instructor_value text;
  eligible_count integer := 0;
  certification_count integer := 0;
  certificate_count integer := 0;
  validity_days integer;
  issue_date_value date;
begin
  select * into event_row
  from public.agency_training_events
  where department_id = p_department_id and id = p_event_id
  for update;

  if not found then raise exception 'Training event not found.'; end if;

  if event_row.status = 'cancelled' then
    raise exception 'Cancelled training cannot be completed.';
  end if;

  if not exists (
    select 1 from public.agency_training_attendees
    where department_id = p_department_id and event_id = p_event_id
  ) then
    raise exception 'Add at least one attendee before completing training.';
  end if;

  if exists (
    select 1 from public.agency_training_attendees
    where department_id = p_department_id and event_id = p_event_id
      and outcome_status = 'pending'
  ) then
    raise exception 'Every attendee needs a final outcome before closeout.';
  end if;

  if event_row.lesson_plan_required and not exists (
    select 1 from public.attachments
    where department_id = p_department_id
      and entity_type = 'agency_training_event'
      and entity_id = p_event_id
      and attachment_type = 'training_lesson_plan'
      and archived_at is null
  ) then
    raise exception 'Attach the required lesson plan before closeout.';
  end if;

  select name into department_name_value
  from public.departments where id = p_department_id;

  select string_agg(display_name, ', ' order by is_lead desc, created_at)
  into instructor_value
  from public.agency_training_event_instructors
  where department_id = p_department_id and event_id = p_event_id;

  select count(*) into eligible_count
  from public.agency_training_attendees
  where department_id = p_department_id and event_id = p_event_id
    and outcome_status in ('completed', 'passed');

  issue_date_value := event_row.starts_at::date;

  if event_row.certification_type_id is not null then
    select * into certification_type_row
    from public.certification_types
    where department_id = p_department_id
      and id = event_row.certification_type_id
      and is_active = true;

    if not found then raise exception 'The configured certification type is unavailable.'; end if;
    validity_days := coalesce(event_row.certification_valid_days, certification_type_row.default_valid_days);
    if certification_type_row.expiration_required and validity_days is null then
      raise exception 'Configure a certification validity period before closeout.';
    end if;

    insert into public.training_certifications (
      department_id, user_id, certification_type_id, certification_title,
      issuing_organization, credential_number, issue_date, expiration_date,
      reminder_days, notes, is_active, record_origin,
      source_training_event_id, source_training_attendee_id,
      created_by_user_id, updated_by_user_id, updated_at
    )
    select
      p_department_id, attendee.user_id, certification_type_row.id,
      certification_type_row.name,
      coalesce(certification_type_row.issuing_organization, department_name_value),
      'AT-' || to_char(issue_date_value, 'YYYY') || '-' || upper(substr(replace(attendee.id::text, '-', ''), 1, 10)),
      issue_date_value,
      case when validity_days is null then null else issue_date_value + validity_days end,
      case when certification_type_row.default_due_soon_days is null
        then array[90,60,30,14,7,0]
        else array[certification_type_row.default_due_soon_days,0]
      end,
      'Created from Agency Training: ' || event_row.title,
      true, 'agency_training', p_event_id, attendee.id,
      p_actor_user_id, p_actor_user_id, now()
    from public.agency_training_attendees attendee
    where attendee.department_id = p_department_id
      and attendee.event_id = p_event_id
      and attendee.outcome_status in ('completed', 'passed')
    on conflict (source_training_attendee_id)
      where source_training_attendee_id is not null
    do update set
      user_id = excluded.user_id,
      certification_type_id = excluded.certification_type_id,
      certification_title = excluded.certification_title,
      issuing_organization = excluded.issuing_organization,
      credential_number = excluded.credential_number,
      issue_date = excluded.issue_date,
      expiration_date = excluded.expiration_date,
      reminder_days = excluded.reminder_days,
      notes = excluded.notes,
      is_active = true,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = now();

    get diagnostics certification_count = row_count;

    update public.training_certifications prior
    set is_active = false, updated_by_user_id = p_actor_user_id, updated_at = now()
    where prior.department_id = p_department_id
      and prior.certification_type_id = event_row.certification_type_id
      and prior.source_training_event_id is distinct from p_event_id
      and prior.issue_date <= issue_date_value
      and prior.user_id in (
        select user_id from public.agency_training_attendees
        where department_id = p_department_id and event_id = p_event_id
          and outcome_status in ('completed', 'passed')
      );

    update public.agency_training_attendees attendee
    set certification_id = certification.id,
        updated_by_user_id = p_actor_user_id,
        updated_at = now()
    from public.training_certifications certification
    where attendee.department_id = p_department_id
      and attendee.event_id = p_event_id
      and certification.source_training_attendee_id = attendee.id;
  end if;

  if event_row.certificate_enabled then
    insert into public.agency_training_certificates (
      department_id, event_id, attendee_id, user_id, certificate_number,
      certificate_title, training_hours, instructor_display, issued_by_user_id, metadata
    )
    select
      p_department_id, p_event_id, attendee.id, attendee.user_id,
      'TP-' || to_char(issue_date_value, 'YYYY') || '-' || upper(substr(replace(attendee.id::text, '-', ''), 1, 10)),
      coalesce(nullif(trim(event_row.certificate_title), ''), event_row.title),
      coalesce(attendee.hours_completed, event_row.default_hours), instructor_value,
      p_actor_user_id,
      jsonb_build_object('event_title', event_row.title, 'event_date', issue_date_value)
    from public.agency_training_attendees attendee
    where attendee.department_id = p_department_id
      and attendee.event_id = p_event_id
      and attendee.outcome_status in ('completed', 'passed')
    on conflict (attendee_id) do update set
      certificate_title = excluded.certificate_title,
      training_hours = excluded.training_hours,
      instructor_display = excluded.instructor_display,
      issued_by_user_id = excluded.issued_by_user_id,
      revoked_at = null,
      revoked_by_user_id = null,
      revocation_reason = null,
      metadata = excluded.metadata;
    get diagnostics certificate_count = row_count;
  end if;

  update public.agency_training_events
  set status = 'completed', closed_at = now(), closed_by_user_id = p_actor_user_id,
      updated_at = now(), updated_by_user_id = p_actor_user_id
  where department_id = p_department_id and id = p_event_id;

  return jsonb_build_object(
    'eventId', p_event_id, 'eligibleAttendees', eligible_count,
    'certifications', certification_count, 'certificates', certificate_count,
    'status', 'completed'
  );
end;
$$;

create or replace function public.reopen_agency_training_event(
  p_department_id uuid,
  p_event_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.agency_training_events%rowtype;
begin
  if nullif(trim(p_reason), '') is null then raise exception 'A reopen reason is required.'; end if;
  select * into event_row from public.agency_training_events
  where department_id = p_department_id and id = p_event_id for update;
  if not found then raise exception 'Training event not found.'; end if;
  if event_row.status <> 'completed' then raise exception 'Only completed training can be reopened.'; end if;

  update public.training_certifications
  set is_active = false, updated_by_user_id = p_actor_user_id, updated_at = now()
  where department_id = p_department_id and source_training_event_id = p_event_id;

  update public.agency_training_attendees
  set certification_id = null, updated_by_user_id = p_actor_user_id, updated_at = now()
  where department_id = p_department_id and event_id = p_event_id;

  update public.agency_training_certificates
  set revoked_at = now(), revoked_by_user_id = p_actor_user_id,
      revocation_reason = 'Training reopened: ' || trim(p_reason)
  where department_id = p_department_id and event_id = p_event_id and revoked_at is null;

  update public.agency_training_events
  set status = 'in_progress', closed_at = null, closed_by_user_id = null,
      reopened_at = now(), reopened_by_user_id = p_actor_user_id,
      reopen_reason = trim(p_reason), updated_at = now(), updated_by_user_id = p_actor_user_id
  where department_id = p_department_id and id = p_event_id;
end;
$$;

revoke all on function public.close_agency_training_event(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.reopen_agency_training_event(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.close_agency_training_event(uuid,uuid,uuid) to service_role;
grant execute on function public.reopen_agency_training_event(uuid,uuid,uuid,text) to service_role;

comment on function public.close_agency_training_event(uuid,uuid,uuid) is
  'Atomically validates and completes Agency Training, issuing idempotent certifications and certificates.';
comment on function public.reopen_agency_training_event(uuid,uuid,uuid,text) is
  'Audited rollback of generated credentials when completed Agency Training is reopened.';

commit;