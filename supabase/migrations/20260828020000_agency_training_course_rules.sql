begin;

create table public.agency_training_courses (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  canonical_title text not null,
  training_type text not null default 'In-Service',
  category text,
  description text,
  topics text[] not null default array[]::text[],
  default_location text,
  default_hours numeric(6,2),
  lesson_plan_required boolean not null default false,
  certification_type_id uuid references public.certification_types(id) on delete set null,
  certification_valid_days integer,
  certificate_enabled boolean not null default false,
  certificate_title text,
  usage_count integer not null default 0,
  last_used_at timestamptz,
  is_active boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_training_courses_title_not_blank
    check (length(trim(canonical_title)) > 0),
  constraint agency_training_courses_hours_valid
    check (default_hours is null or default_hours >= 0),
  constraint agency_training_courses_valid_days_valid
    check (certification_valid_days is null or certification_valid_days > 0)
);

create unique index agency_training_courses_title_unique
  on public.agency_training_courses(department_id, lower(trim(canonical_title)));

create index agency_training_courses_active_idx
  on public.agency_training_courses(department_id, is_active, canonical_title);

create table public.agency_training_course_aliases (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  course_id uuid not null references public.agency_training_courses(id) on delete cascade,
  alias_title text not null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint agency_training_course_alias_not_blank
    check (length(trim(alias_title)) > 0)
);

create unique index agency_training_course_alias_unique
  on public.agency_training_course_aliases(department_id, lower(trim(alias_title)));

alter table public.agency_training_events
  add column if not exists course_id uuid
    references public.agency_training_courses(id) on delete set null;

create index if not exists agency_training_events_course_idx
  on public.agency_training_events(department_id, course_id, starts_at desc);

create table public.agency_training_requirements (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  course_id uuid not null references public.agency_training_courses(id) on delete cascade,
  requirement_name text not null,
  scope_type text not null default 'all_members',
  scope_values text[] not null default array[]::text[],
  interval_value integer,
  interval_unit text,
  due_basis text not null default 'completion_date',
  fixed_month integer,
  fixed_day integer,
  warning_days integer[] not null default array[90,60,30,14,7,0],
  grace_days integer not null default 0,
  notify_member_inbox boolean not null default true,
  notify_member_email boolean not null default true,
  notify_training_staff_inbox boolean not null default true,
  notify_training_staff_email boolean not null default true,
  responsible_permission text not null default 'manage_training',
  is_active boolean not null default true,
  notes text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_training_requirements_name_not_blank
    check (length(trim(requirement_name)) > 0),
  constraint agency_training_requirements_scope_valid
    check (scope_type in ('all_members', 'role', 'rank', 'unit', 'selected_members')),
  constraint agency_training_requirements_interval_valid
    check (
      (interval_value is null and interval_unit is null)
      or (
        interval_value > 0
        and interval_unit in ('days', 'months', 'years', 'calendar_year')
      )
    ),
  constraint agency_training_requirements_due_basis_valid
    check (due_basis in ('completion_date', 'fixed_annual_date')),
  constraint agency_training_requirements_fixed_date_valid
    check (
      due_basis <> 'fixed_annual_date'
      or (
        fixed_month between 1 and 12
        and fixed_day between 1 and 31
      )
    ),
  constraint agency_training_requirements_grace_valid
    check (grace_days >= 0)
);

create unique index agency_training_requirements_course_name_unique
  on public.agency_training_requirements(
    department_id,
    course_id,
    lower(trim(requirement_name))
  );

create index agency_training_requirements_active_idx
  on public.agency_training_requirements(department_id, is_active, course_id);

create table public.agency_training_requirement_members (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  requirement_id uuid not null references public.agency_training_requirements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint agency_training_requirement_member_unique
    unique (requirement_id, user_id)
);

alter table public.training_certifications
  add column if not exists record_origin text not null default 'manual',
  add column if not exists source_training_event_id uuid
    references public.agency_training_events(id) on delete set null,
  add column if not exists source_training_attendee_id uuid
    references public.agency_training_attendees(id) on delete set null;

create unique index if not exists training_certifications_source_attendee_unique
  on public.training_certifications(source_training_attendee_id)
  where source_training_attendee_id is not null;

create index if not exists training_certifications_source_event_idx
  on public.training_certifications(department_id, source_training_event_id);

alter table public.agency_training_courses enable row level security;
alter table public.agency_training_course_aliases enable row level security;
alter table public.agency_training_requirements enable row level security;
alter table public.agency_training_requirement_members enable row level security;

create policy "department members can view agency training courses"
  on public.agency_training_courses for select
  using (public.is_department_member(department_id));

create policy "training managers can manage agency training courses"
  on public.agency_training_courses for all
  using (
    public.has_department_permission(department_id, 'manage_training')
    or public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  )
  with check (
    public.has_department_permission(department_id, 'manage_training')
    or public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  );

create policy "department members can view agency training course aliases"
  on public.agency_training_course_aliases for select
  using (public.is_department_member(department_id));

create policy "training managers can manage agency training course aliases"
  on public.agency_training_course_aliases for all
  using (
    public.has_department_permission(department_id, 'manage_training')
    or public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  )
  with check (
    public.has_department_permission(department_id, 'manage_training')
    or public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'administer_department')
  );

create policy "department members can view agency training requirements"
  on public.agency_training_requirements for select
  using (public.is_department_member(department_id));

create policy "training managers can manage agency training requirements"
  on public.agency_training_requirements for all
  using (
    public.has_department_permission(department_id, 'manage_training')
    or public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'administer_department')
  )
  with check (
    public.has_department_permission(department_id, 'manage_training')
    or public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'administer_department')
  );

create policy "department members can view agency training requirement members"
  on public.agency_training_requirement_members for select
  using (public.is_department_member(department_id));

create policy "training managers can manage agency training requirement members"
  on public.agency_training_requirement_members for all
  using (
    public.has_department_permission(department_id, 'manage_training')
    or public.has_department_permission(department_id, 'manage_certifications')
    or public.has_department_permission(department_id, 'administer_department')
  )
  with check (
    public.has_department_permission(department_id, 'manage_training')
    or public.has_department_permission(department_id, 'manage_certifications')
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
    'agency_training_courses',
    'agency_training_course_aliases',
    'agency_training_requirements',
    'agency_training_requirement_members'
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

comment on table public.agency_training_courses is
  'Canonical agency course library used to prevent duplicate course identities and supply event defaults.';
comment on table public.agency_training_course_aliases is
  'Recognized alternate titles that resolve to a canonical agency training course.';
comment on table public.agency_training_requirements is
  'Agency-configured recurring training cadence, applicability, warning, and notification rules.';
comment on column public.training_certifications.source_training_attendee_id is
  'Idempotent provenance link preventing duplicate certification issuance from one attendee closeout.';

commit;