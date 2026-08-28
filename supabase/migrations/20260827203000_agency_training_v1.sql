begin;

create table public.agency_training_events (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  title text not null,
  training_type text not null default 'In-Service',
  category text,
  description text,
  topics text[] not null default array[]::text[],
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  default_hours numeric(6,2),
  status text not null default 'draft',
  certification_type_id uuid references public.certification_types(id) on delete set null,
  certification_valid_days integer,
  certificate_enabled boolean not null default false,
  certificate_title text,
  lesson_plan_required boolean not null default false,
  notes text,
  closed_at timestamptz,
  closed_by_user_id uuid references auth.users(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_training_events_title_not_blank
    check (length(trim(title)) > 0),
  constraint agency_training_events_time_order
    check (ends_at is null or ends_at >= starts_at),
  constraint agency_training_events_hours_valid
    check (default_hours is null or default_hours >= 0),
  constraint agency_training_events_valid_days_valid
    check (certification_valid_days is null or certification_valid_days > 0),
  constraint agency_training_events_status_valid
    check (status in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled'))
);

create index agency_training_events_department_date_idx
  on public.agency_training_events(department_id, starts_at desc);

create index agency_training_events_department_status_idx
  on public.agency_training_events(department_id, status, starts_at desc);

create table public.agency_training_event_instructors (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  event_id uuid not null references public.agency_training_events(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  organization text,
  credentials text,
  instructor_role text not null default 'Instructor',
  is_lead boolean not null default false,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint agency_training_instructor_name_not_blank
    check (length(trim(display_name)) > 0)
);

create index agency_training_instructors_event_idx
  on public.agency_training_event_instructors(department_id, event_id, is_lead desc);

create table public.agency_training_attendees (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  event_id uuid not null references public.agency_training_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  attendance_status text not null default 'assigned',
  outcome_status text not null default 'pending',
  hours_completed numeric(6,2),
  score_text text,
  result_notes text,
  remedial_notes text,
  certification_id uuid references public.training_certifications(id) on delete set null,
  recorded_by_user_id uuid references auth.users(id) on delete set null,
  recorded_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_training_attendees_event_user_unique unique (event_id, user_id),
  constraint agency_training_attendance_status_valid
    check (attendance_status in ('assigned', 'present', 'excused', 'no_show')),
  constraint agency_training_outcome_status_valid
    check (outcome_status in (
      'pending',
      'completed',
      'passed',
      'failed',
      'incomplete',
      'remedial_required'
    )),
  constraint agency_training_attendee_hours_valid
    check (hours_completed is null or hours_completed >= 0)
);

create index agency_training_attendees_event_idx
  on public.agency_training_attendees(department_id, event_id, outcome_status);

create index agency_training_attendees_user_idx
  on public.agency_training_attendees(department_id, user_id, created_at desc);

create table public.agency_training_certificates (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  event_id uuid not null references public.agency_training_events(id) on delete cascade,
  attendee_id uuid not null references public.agency_training_attendees(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  certificate_number text not null,
  verification_code uuid not null default gen_random_uuid(),
  certificate_title text not null,
  training_hours numeric(6,2),
  instructor_display text,
  issued_at timestamptz not null default now(),
  issued_by_user_id uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users(id) on delete set null,
  revocation_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint agency_training_certificate_attendee_unique unique (attendee_id),
  constraint agency_training_certificate_number_department_unique
    unique (department_id, certificate_number),
  constraint agency_training_certificate_verification_unique unique (verification_code),
  constraint agency_training_certificate_title_not_blank
    check (length(trim(certificate_title)) > 0),
  constraint agency_training_certificate_hours_valid
    check (training_hours is null or training_hours >= 0)
);

create index agency_training_certificates_user_idx
  on public.agency_training_certificates(department_id, user_id, issued_at desc);

alter table public.agency_training_events enable row level security;
alter table public.agency_training_event_instructors enable row level security;
alter table public.agency_training_attendees enable row level security;
alter table public.agency_training_certificates enable row level security;

create policy "department members can view agency training events"
  on public.agency_training_events for select
  using (public.is_department_member(department_id));

create policy "training managers can insert agency training events"
  on public.agency_training_events for insert
  with check (
    public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  );

create policy "training managers can update agency training events"
  on public.agency_training_events for update
  using (
    public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  )
  with check (
    public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  );

create policy "training managers can delete agency training events"
  on public.agency_training_events for delete
  using (
    public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  );

create policy "department members can view agency training instructors"
  on public.agency_training_event_instructors for select
  using (public.is_department_member(department_id));

create policy "training managers can manage agency training instructors"
  on public.agency_training_event_instructors for all
  using (
    public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  )
  with check (
    public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  );

create policy "department members can view agency training attendees"
  on public.agency_training_attendees for select
  using (public.is_department_member(department_id));

create policy "training managers can manage agency training attendees"
  on public.agency_training_attendees for all
  using (
    public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  )
  with check (
    public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  );

create policy "department members can view agency training certificates"
  on public.agency_training_certificates for select
  using (public.is_department_member(department_id));

create policy "training managers can manage agency training certificates"
  on public.agency_training_certificates for all
  using (
    public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  )
  with check (
    public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  );

do $$
declare
  table_name text;
  trigger_name text;
begin
  if to_regprocedure('public.write_audit_event()') is null then
    raise exception 'Required audit function public.write_audit_event() is missing.';
  end if;

  foreach table_name in array array[
    'agency_training_events',
    'agency_training_event_instructors',
    'agency_training_attendees',
    'agency_training_certificates'
  ]
  loop
    trigger_name := table_name || '_accountability_audit';
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.write_audit_event()',
      trigger_name,
      table_name
    );
  end loop;
end;
$$;

comment on table public.agency_training_events is
  'Tenant-scoped agency training events from planning through closeout.';
comment on table public.agency_training_event_instructors is
  'Internal and external instructors assigned to an agency training event.';
comment on table public.agency_training_attendees is
  'Per-member attendance, outcome, hours, remediation, and certification linkage.';
comment on table public.agency_training_certificates is
  'Stable, verifiable certificate issuance records generated from completed training outcomes.';

commit;