-- TracePoint backend foundation
-- Generated for the current TracePoint prototype data model.
-- Apply through the Supabase CLI as a tracked migration.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.firearm_type as enum (
  'handgun',
  'rifle',
  'shotgun',
  'less_lethal',
  'other'
);

create type public.firearm_status as enum (
  'in_service',
  'assigned',
  'maintenance',
  'inspection_required',
  'out_of_service',
  'retired',
  'missing'
);

create type public.range_day_status as enum (
  'planned',
  'in_progress',
  'completed',
  'locked',
  'archived'
);

create type public.range_day_type as enum (
  'qualification',
  'rifle',
  'low_light',
  'remedial',
  'make_up',
  'training'
);

create type public.packet_status as enum (
  'needs_setup',
  'in_progress',
  'ready'
);

create type public.drill_category as enum (
  'qualification',
  'marksmanship',
  'movement',
  'low_light',
  'decision_making',
  'rifle',
  'shotgun',
  'transition',
  'malfunction_clearance',
  'active_shooter',
  'administrative',
  'remedial',
  'other'
);

create type public.drill_difficulty as enum (
  'basic',
  'intermediate',
  'advanced',
  'instructor_discretion'
);

create type public.drill_library_status as enum (
  'active',
  'inactive',
  'archived'
);

create type public.scoring_format as enum (
  'qualification',
  'points',
  'time',
  'pass_fail',
  'completion',
  'hit_count',
  'notes_only'
);

create type public.attendance_status as enum (
  'scheduled',
  'present',
  'absent',
  'excused'
);

create type public.malfunction_type as enum (
  'failure_to_feed',
  'failure_to_eject',
  'failure_to_fire',
  'light_primer_strike',
  'magazine_issue',
  'optic_failure',
  'weapon_light_failure',
  'trigger_issue',
  'catastrophic_failure',
  'other'
);

create type public.inspection_reason as enum (
  'scheduled',
  'malfunction',
  'pre_issue',
  'post_repair',
  'annual',
  'other'
);

create type public.lighting_condition as enum (
  'day',
  'night',
  'low_light',
  'not_applicable'
);

create type public.off_duty_request_status as enum (
  'draft',
  'pending_command_review',
  'returned_for_correction',
  'approved',
  'denied',
  'withdrawn',
  'archived'
);

create type public.authorization_status as enum (
  'not_authorized',
  'authorized',
  'expiring_soon',
  'expired',
  'revoked'
);

create type public.inspection_status as enum (
  'current',
  'due_soon',
  'overdue'
);

create type public.compliance_status as enum (
  'authorized',
  'at_risk',
  'non_compliant'
);

create type public.off_duty_action as enum (
  'submitted',
  'resubmitted',
  'approved',
  'denied',
  'returned_for_correction',
  'withdrawn',
  'revoked',
  'archived'
);

create type public.inbox_status as enum (
  'open',
  'read',
  'resolved',
  'dismissed'
);

create type public.priority_level as enum (
  'normal',
  'high',
  'critical'
);

create type public.alert_status as enum (
  'open',
  'acknowledged',
  'resolved',
  'dismissed'
);

create type public.alert_severity as enum (
  'low',
  'medium',
  'high',
  'critical'
);

-- ---------------------------------------------------------------------------
-- Identity, tenancy, roles, and permissions
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text,
  slug text not null unique,
  timezone text not null default 'America/New_York',
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  code text primary key,
  display_name text not null,
  description text,
  sort_order integer not null default 0
);

create table public.permissions (
  code text primary key,
  display_name text not null,
  description text
);

create table public.role_permissions (
  role_code text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

create table public.department_memberships (
  department_id uuid not null references public.departments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_number text,
  rank_title text,
  unit_name text,
  employee_number text,
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (department_id, user_id),
  unique (department_id, badge_number)
);

create table public.department_membership_roles (
  department_id uuid not null,
  user_id uuid not null,
  role_code text not null references public.roles(code) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (department_id, user_id, role_code),
  foreign key (department_id, user_id)
    references public.department_memberships(department_id, user_id)
    on delete cascade
);

insert into public.roles (code, display_name, description, sort_order) values
  ('officer', 'Officer', 'Standard officer access and personal workflows.', 10),
  ('instructor', 'Instructor', 'Range scoring and qualification access.', 20),
  ('range_master', 'Range Master', 'Range planning, drill library, scoring, and packets.', 30),
  ('armorer', 'Armorer', 'Firearm, inspection, and maintenance management.', 40),
  ('supervisor', 'Supervisor', 'Supervisory review and operational visibility.', 50),
  ('command_staff', 'Command Staff', 'Command dashboard, analytics, and approvals.', 60),
  ('chief', 'Chief', 'Chief approval authority and full command visibility.', 70),
  ('administrator', 'Administrator', 'Department configuration and full tenant administration.', 80);

insert into public.permissions (code, display_name, description) values
  ('view_command_dashboard', 'View Command Dashboard', 'View department-wide command metrics and queues.'),
  ('view_analytics', 'View Analytics', 'View qualification, drill, firearm, and performance analytics.'),
  ('manage_users', 'Manage Users', 'Manage department memberships and role assignments.'),
  ('manage_firearms', 'Manage Firearms', 'Create and update department firearm records and assignments.'),
  ('manage_inspections', 'Manage Inspections', 'Record and manage firearm inspections and maintenance actions.'),
  ('manage_range_days', 'Manage Range Days', 'Create, edit, archive, and lock range days and rosters.'),
  ('score_range_days', 'Score Range Days', 'Enter and update drill and qualification results.'),
  ('manage_qualifications', 'Manage Qualifications', 'Manage qualification courses, versions, and records.'),
  ('submit_off_duty_requests', 'Submit Off-Duty Requests', 'Submit and correct personal/off-duty firearm requests.'),
  ('review_off_duty_requests', 'Review Off-Duty Requests', 'Approve, deny, return, revoke, and archive requests.'),
  ('view_audit_log', 'View Audit Log', 'View department audit events.'),
  ('administer_department', 'Administer Department', 'Manage all department settings and security configuration.');

insert into public.role_permissions (role_code, permission_code) values
  ('officer', 'submit_off_duty_requests'),

  ('instructor', 'score_range_days'),
  ('instructor', 'manage_qualifications'),
  ('instructor', 'submit_off_duty_requests'),

  ('range_master', 'manage_range_days'),
  ('range_master', 'score_range_days'),
  ('range_master', 'manage_qualifications'),
  ('range_master', 'view_analytics'),
  ('range_master', 'submit_off_duty_requests'),

  ('armorer', 'manage_firearms'),
  ('armorer', 'manage_inspections'),
  ('armorer', 'view_analytics'),
  ('armorer', 'submit_off_duty_requests'),

  ('supervisor', 'view_analytics'),
  ('supervisor', 'score_range_days'),
  ('supervisor', 'manage_qualifications'),
  ('supervisor', 'submit_off_duty_requests'),

  ('command_staff', 'view_command_dashboard'),
  ('command_staff', 'view_analytics'),
  ('command_staff', 'manage_range_days'),
  ('command_staff', 'score_range_days'),
  ('command_staff', 'manage_qualifications'),
  ('command_staff', 'review_off_duty_requests'),
  ('command_staff', 'view_audit_log'),
  ('command_staff', 'submit_off_duty_requests'),

  ('chief', 'view_command_dashboard'),
  ('chief', 'view_analytics'),
  ('chief', 'manage_users'),
  ('chief', 'manage_firearms'),
  ('chief', 'manage_inspections'),
  ('chief', 'manage_range_days'),
  ('chief', 'score_range_days'),
  ('chief', 'manage_qualifications'),
  ('chief', 'review_off_duty_requests'),
  ('chief', 'view_audit_log'),
  ('chief', 'submit_off_duty_requests'),

  ('administrator', 'view_command_dashboard'),
  ('administrator', 'view_analytics'),
  ('administrator', 'manage_users'),
  ('administrator', 'manage_firearms'),
  ('administrator', 'manage_inspections'),
  ('administrator', 'manage_range_days'),
  ('administrator', 'score_range_days'),
  ('administrator', 'manage_qualifications'),
  ('administrator', 'review_off_duty_requests'),
  ('administrator', 'view_audit_log'),
  ('administrator', 'submit_off_duty_requests'),
  ('administrator', 'administer_department');

-- ---------------------------------------------------------------------------
-- Firearms, assignments, inspections, and malfunctions
-- ---------------------------------------------------------------------------

create table public.firearms (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  serial_number text not null,
  make text not null,
  model text not null,
  caliber text not null,
  firearm_type public.firearm_type not null,
  status public.firearm_status not null default 'in_service',
  asset_number text,
  round_count integer not null default 0 check (round_count >= 0),
  acquisition_date date,
  retired_date date,
  last_inspection_date date,
  next_inspection_due date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, serial_number),
  unique (id, department_id)
);

create table public.firearm_assignments (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  firearm_id uuid not null,
  assigned_to_user_id uuid not null,
  assigned_by_user_id uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  returned_at timestamptz,
  returned_to_user_id uuid references auth.users(id) on delete set null,
  issue_condition text,
  return_condition text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (firearm_id, department_id)
    references public.firearms(id, department_id)
    on delete cascade,
  foreign key (department_id, assigned_to_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  unique (id, department_id)
);

create unique index firearm_assignments_one_active_per_firearm
  on public.firearm_assignments(firearm_id)
  where returned_at is null;

create table public.firearm_inspections (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  firearm_id uuid not null,
  inspection_date date not null,
  inspected_by_user_id uuid not null,
  reason public.inspection_reason not null,
  findings text,
  corrective_action text,
  returned_to_service boolean not null default false,
  next_inspection_due date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (firearm_id, department_id)
    references public.firearms(id, department_id)
    on delete cascade,
  foreign key (department_id, inspected_by_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  unique (id, department_id)
);

-- ---------------------------------------------------------------------------
-- Drill library and range-day planning
-- ---------------------------------------------------------------------------

create table public.drill_templates (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null,
  category public.drill_category not null,
  description text,
  instructions text,
  firearm_type public.firearm_type,
  any_firearm_type boolean not null default false,
  round_count integer check (round_count is null or round_count >= 0),
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes >= 0),
  difficulty public.drill_difficulty,
  scoring_format public.scoring_format not null,
  default_passing_score numeric(10,2),
  default_max_score numeric(10,2),
  default_passing_time_seconds numeric(10,3),
  default_minimum_hits integer,
  default_run_count integer not null default 1 check (default_run_count > 0),
  default_required boolean not null default true,
  tags text[] not null default '{}',
  status public.drill_library_status not null default 'active',
  notes text,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (department_id, created_by_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  unique (id, department_id)
);

create table public.range_days (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  title text not null,
  range_date date not null,
  start_time time,
  end_time time,
  location text not null,
  status public.range_day_status not null default 'planned',
  range_type public.range_day_type not null default 'training',
  packet_status public.packet_status not null default 'needs_setup',
  lead_instructor_user_id uuid not null,
  weather text,
  notes text,
  staffing_notes text,
  outline jsonb not null default '[]'::jsonb,
  locked_at timestamptz,
  locked_by_user_id uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (department_id, lead_instructor_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  foreign key (department_id, created_by_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  unique (id, department_id)
);

create table public.range_day_instructors (
  department_id uuid not null,
  range_day_id uuid not null,
  user_id uuid not null,
  is_lead boolean not null default false,
  assigned_at timestamptz not null default now(),
  primary key (range_day_id, user_id),
  foreign key (range_day_id, department_id)
    references public.range_days(id, department_id)
    on delete cascade,
  foreign key (department_id, user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict
);

create table public.range_day_roster (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  range_day_id uuid not null,
  officer_user_id uuid not null,
  attendance_status public.attendance_status not null default 'scheduled',
  attendance_time timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (range_day_id, department_id)
    references public.range_days(id, department_id)
    on delete cascade,
  foreign key (department_id, officer_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  unique (range_day_id, officer_user_id),
  unique (id, department_id)
);

create table public.range_day_roster_firearms (
  department_id uuid not null,
  roster_entry_id uuid not null,
  firearm_id uuid not null,
  is_primary boolean not null default false,
  assigned_at timestamptz not null default now(),
  primary key (roster_entry_id, firearm_id),
  foreign key (roster_entry_id, department_id)
    references public.range_day_roster(id, department_id)
    on delete cascade,
  foreign key (firearm_id, department_id)
    references public.firearms(id, department_id)
    on delete restrict
);

create table public.range_day_drills (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  range_day_id uuid not null,
  display_order integer not null default 0,
  name text not null,
  category public.drill_category not null,
  description text,
  instructions text,
  scoring_format public.scoring_format not null,
  passing_score numeric(10,2),
  max_score numeric(10,2),
  passing_time_seconds numeric(10,3),
  minimum_hits integer,
  run_count integer not null default 1 check (run_count > 0),
  required boolean not null default true,
  firearm_type public.firearm_type,
  any_firearm_type boolean not null default false,
  round_count integer check (round_count is null or round_count >= 0),
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes >= 0),
  difficulty public.drill_difficulty,
  source_template_id uuid,
  source_template_name text,
  copied_from_library_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (range_day_id, department_id)
    references public.range_days(id, department_id)
    on delete cascade,
  foreign key (source_template_id, department_id)
    references public.drill_templates(id, department_id)
    on delete restrict,
  unique (id, department_id)
);

create table public.drill_run_results (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  range_day_id uuid not null,
  range_day_drill_id uuid not null,
  officer_user_id uuid not null,
  firearm_id uuid,
  run_number integer not null check (run_number > 0),
  scoring_format_snapshot public.scoring_format not null,
  completed boolean not null default false,
  score numeric(10,2),
  time_seconds numeric(10,3),
  hit_count integer,
  passed boolean,
  instructor_user_id uuid not null,
  notes text,
  deficiency_observed boolean not null default false,
  remedial_training_recommended boolean not null default false,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (range_day_id, department_id)
    references public.range_days(id, department_id)
    on delete cascade,
  foreign key (range_day_drill_id, department_id)
    references public.range_day_drills(id, department_id)
    on delete cascade,
  foreign key (department_id, officer_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  foreign key (department_id, instructor_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  foreign key (firearm_id, department_id)
    references public.firearms(id, department_id)
    on delete restrict,
  unique (range_day_drill_id, officer_user_id, run_number),
  unique (id, department_id)
);

create table public.firearm_malfunctions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  firearm_id uuid not null,
  officer_user_id uuid,
  range_day_id uuid,
  drill_run_result_id uuid,
  malfunction_type public.malfunction_type not null,
  occurred_at timestamptz not null default now(),
  resolved_on_range boolean not null default false,
  removed_from_service boolean not null default false,
  inspection_required boolean not null default false,
  notes text,
  reported_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (firearm_id, department_id)
    references public.firearms(id, department_id)
    on delete cascade,
  foreign key (department_id, officer_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  foreign key (range_day_id, department_id)
    references public.range_days(id, department_id)
    on delete restrict,
  foreign key (drill_run_result_id, department_id)
    references public.drill_run_results(id, department_id)
    on delete restrict,
  foreign key (department_id, reported_by_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  unique (id, department_id)
);

-- ---------------------------------------------------------------------------
-- Qualifications, observations, remediation, and packets
-- ---------------------------------------------------------------------------

create table public.qualification_courses (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null,
  firearm_type public.firearm_type not null,
  description text,
  is_active boolean not null default true,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (department_id, created_by_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  unique (id, department_id)
);

create table public.qualification_course_versions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  qualification_course_id uuid not null,
  version_name text not null,
  effective_date date not null,
  passing_score numeric(10,2) not null,
  max_score numeric(10,2) not null,
  valid_for_months integer check (valid_for_months is null or valid_for_months > 0),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (qualification_course_id, department_id)
    references public.qualification_courses(id, department_id)
    on delete cascade,
  unique (id, department_id)
);

create unique index qualification_course_versions_one_active
  on public.qualification_course_versions(qualification_course_id)
  where is_active;

create table public.qualification_results (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  officer_user_id uuid not null,
  firearm_id uuid,
  qualification_course_id uuid not null,
  qualification_course_version_id uuid not null,
  range_day_id uuid,
  drill_run_result_id uuid,
  qualification_date date not null,
  lighting_condition public.lighting_condition not null default 'not_applicable',
  score numeric(10,2) not null,
  passed boolean not null,
  expires_on date,
  instructor_user_id uuid not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (department_id, officer_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  foreign key (firearm_id, department_id)
    references public.firearms(id, department_id)
    on delete restrict,
  foreign key (qualification_course_id, department_id)
    references public.qualification_courses(id, department_id)
    on delete restrict,
  foreign key (qualification_course_version_id, department_id)
    references public.qualification_course_versions(id, department_id)
    on delete restrict,
  foreign key (range_day_id, department_id)
    references public.range_days(id, department_id)
    on delete restrict,
  foreign key (drill_run_result_id, department_id)
    references public.drill_run_results(id, department_id)
    on delete restrict,
  foreign key (department_id, instructor_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  unique (id, department_id)
);

create table public.instructor_observations (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  range_day_id uuid not null,
  officer_user_id uuid not null,
  instructor_user_id uuid not null,
  category text not null check (
    category in ('Safety', 'Marksmanship', 'Movement', 'Decision Making', 'Weapon Handling', 'Other')
  ),
  observation text not null,
  positive_observation boolean not null default false,
  remedial_training_recommended boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (range_day_id, department_id)
    references public.range_days(id, department_id)
    on delete cascade,
  foreign key (department_id, officer_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  foreign key (department_id, instructor_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  unique (id, department_id)
);

create table public.remedial_training_recommendations (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  officer_user_id uuid not null,
  range_day_id uuid not null,
  created_by_instructor_user_id uuid not null,
  reason text not null,
  assigned_date date not null default current_date,
  completed boolean not null default false,
  completed_date date,
  completed_by_user_id uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (department_id, officer_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  foreign key (range_day_id, department_id)
    references public.range_days(id, department_id)
    on delete cascade,
  foreign key (department_id, created_by_instructor_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  unique (id, department_id)
);

create table public.range_packets (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  range_day_id uuid not null,
  generated_by_user_id uuid not null,
  generated_at timestamptz not null default now(),
  includes_roster boolean not null default true,
  includes_qualification_sheets boolean not null default true,
  includes_drill_sheets boolean not null default true,
  includes_remedial_section boolean not null default true,
  includes_instructor_notes boolean not null default true,
  storage_path text,
  foreign key (range_day_id, department_id)
    references public.range_days(id, department_id)
    on delete cascade,
  foreign key (department_id, generated_by_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  unique (id, department_id)
);

-- ---------------------------------------------------------------------------
-- Off-duty firearm workflow
-- ---------------------------------------------------------------------------

create table public.off_duty_firearm_requests (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  officer_user_id uuid not null,
  make text not null,
  model text not null,
  firearm_type text not null,
  serial_number text not null,
  caliber text not null,
  capacity text,
  optic text,
  weapon_light text,
  holster text,
  proof_of_ownership_reviewed boolean not null default false,
  qualification_reviewed boolean not null default false,
  inspection_reviewed boolean not null default false,
  policy_acknowledged boolean not null default false,
  officer_notes text,
  request_status public.off_duty_request_status not null default 'draft',
  authorization_status public.authorization_status not null default 'not_authorized',
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid,
  approval_date date,
  approval_expires_on date,
  decision_notes text,
  last_qualification_date date,
  inspection_status public.inspection_status not null default 'current',
  compliance_status public.compliance_status not null default 'non_compliant',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (department_id, officer_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  foreign key (department_id, reviewed_by_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  unique (id, department_id)
);

create table public.off_duty_request_actions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  request_id uuid not null,
  action public.off_duty_action not null,
  performed_by_user_id uuid not null,
  from_status public.off_duty_request_status,
  to_status public.off_duty_request_status not null,
  notes text,
  created_at timestamptz not null default now(),
  foreign key (request_id, department_id)
    references public.off_duty_firearm_requests(id, department_id)
    on delete cascade,
  foreign key (department_id, performed_by_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  unique (id, department_id)
);

-- ---------------------------------------------------------------------------
-- Unified inbox, alerts, and audit
-- ---------------------------------------------------------------------------

create table public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  assigned_to_user_id uuid,
  assigned_to_role_code text references public.roles(code) on delete set null,
  title text not null,
  message text not null,
  source_type text not null,
  source_id uuid,
  href text,
  priority public.priority_level not null default 'normal',
  status public.inbox_status not null default 'open',
  due_at timestamptz,
  read_at timestamptz,
  resolved_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (department_id, assigned_to_user_id)
    references public.department_memberships(department_id, user_id)
    on delete cascade,
  check (assigned_to_user_id is not null or assigned_to_role_code is not null),
  unique (id, department_id)
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  alert_type text not null,
  severity public.alert_severity not null,
  status public.alert_status not null default 'open',
  title text not null,
  message text not null,
  assigned_to_user_id uuid,
  assigned_to_role_code text references public.roles(code) on delete set null,
  related_officer_user_id uuid,
  related_firearm_id uuid,
  related_range_day_id uuid,
  related_qualification_result_id uuid,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  foreign key (department_id, assigned_to_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  foreign key (department_id, related_officer_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  foreign key (related_firearm_id, department_id)
    references public.firearms(id, department_id)
    on delete restrict,
  foreign key (related_range_day_id, department_id)
    references public.range_days(id, department_id)
    on delete restrict,
  foreign key (related_qualification_result_id, department_id)
    references public.qualification_results(id, department_id)
    on delete restrict,
  unique (id, department_id)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  department_id uuid not null references public.departments(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index department_memberships_user_idx
  on public.department_memberships(user_id, is_active);

create index membership_roles_user_idx
  on public.department_membership_roles(user_id, department_id);

create index firearms_department_status_idx
  on public.firearms(department_id, status);

create index firearm_assignments_department_user_idx
  on public.firearm_assignments(department_id, assigned_to_user_id, returned_at);

create index firearm_inspections_due_idx
  on public.firearm_inspections(department_id, next_inspection_due);

create index drill_templates_department_status_idx
  on public.drill_templates(department_id, status, category);

create index range_days_department_date_idx
  on public.range_days(department_id, range_date desc);

create index range_days_department_status_idx
  on public.range_days(department_id, status);

create index range_roster_officer_idx
  on public.range_day_roster(department_id, officer_user_id, range_day_id);

create index range_drills_range_day_idx
  on public.range_day_drills(range_day_id, display_order);

create index drill_results_officer_idx
  on public.drill_run_results(department_id, officer_user_id, recorded_at desc);

create index drill_results_range_day_idx
  on public.drill_run_results(range_day_id, range_day_drill_id);

create index malfunctions_firearm_idx
  on public.firearm_malfunctions(department_id, firearm_id, occurred_at desc);

create index qualification_results_officer_idx
  on public.qualification_results(department_id, officer_user_id, qualification_date desc);

create index qualification_results_firearm_idx
  on public.qualification_results(department_id, firearm_id, qualification_date desc);

create index off_duty_requests_status_idx
  on public.off_duty_firearm_requests(department_id, request_status, authorization_status);

create index inbox_items_user_idx
  on public.inbox_items(department_id, assigned_to_user_id, status, created_at desc);

create index inbox_items_role_idx
  on public.inbox_items(department_id, assigned_to_role_code, status, created_at desc);

create index alerts_status_idx
  on public.alerts(department_id, status, severity, created_at desc);

create index audit_events_department_idx
  on public.audit_events(department_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Updated-at and profile bootstrap functions
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, 'TracePoint User'), '@', 1)
    ),
    new.email
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger departments_set_updated_at
before update on public.departments
for each row execute function public.set_updated_at();

create trigger memberships_set_updated_at
before update on public.department_memberships
for each row execute function public.set_updated_at();

create trigger firearms_set_updated_at
before update on public.firearms
for each row execute function public.set_updated_at();

create trigger firearm_assignments_set_updated_at
before update on public.firearm_assignments
for each row execute function public.set_updated_at();

create trigger firearm_inspections_set_updated_at
before update on public.firearm_inspections
for each row execute function public.set_updated_at();

create trigger drill_templates_set_updated_at
before update on public.drill_templates
for each row execute function public.set_updated_at();

create trigger range_days_set_updated_at
before update on public.range_days
for each row execute function public.set_updated_at();

create trigger range_roster_set_updated_at
before update on public.range_day_roster
for each row execute function public.set_updated_at();

create trigger range_day_drills_set_updated_at
before update on public.range_day_drills
for each row execute function public.set_updated_at();

create trigger drill_results_set_updated_at
before update on public.drill_run_results
for each row execute function public.set_updated_at();

create trigger malfunctions_set_updated_at
before update on public.firearm_malfunctions
for each row execute function public.set_updated_at();

create trigger qualification_courses_set_updated_at
before update on public.qualification_courses
for each row execute function public.set_updated_at();

create trigger qualification_versions_set_updated_at
before update on public.qualification_course_versions
for each row execute function public.set_updated_at();

create trigger qualification_results_set_updated_at
before update on public.qualification_results
for each row execute function public.set_updated_at();

create trigger remedial_set_updated_at
before update on public.remedial_training_recommendations
for each row execute function public.set_updated_at();

create trigger off_duty_requests_set_updated_at
before update on public.off_duty_firearm_requests
for each row execute function public.set_updated_at();

create trigger inbox_items_set_updated_at
before update on public.inbox_items
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tenant-security helper functions
-- ---------------------------------------------------------------------------

create or replace function public.is_department_member(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.department_memberships membership
    where membership.department_id = p_department_id
      and membership.user_id = auth.uid()
      and membership.is_active
  );
$$;

create or replace function public.has_department_role(
  p_department_id uuid,
  p_role_codes text[]
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.department_membership_roles membership_role
    join public.department_memberships membership
      on membership.department_id = membership_role.department_id
     and membership.user_id = membership_role.user_id
    where membership_role.department_id = p_department_id
      and membership_role.user_id = auth.uid()
      and membership_role.role_code = any(p_role_codes)
      and membership.is_active
  );
$$;

create or replace function public.has_department_permission(
  p_department_id uuid,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.department_membership_roles membership_role
    join public.department_memberships membership
      on membership.department_id = membership_role.department_id
     and membership.user_id = membership_role.user_id
    join public.role_permissions role_permission
      on role_permission.role_code = membership_role.role_code
    where membership_role.department_id = p_department_id
      and membership_role.user_id = auth.uid()
      and role_permission.permission_code = p_permission_code
      and membership.is_active
  );
$$;

create or replace function public.create_department_with_owner(
  p_name text,
  p_slug text,
  p_short_name text default null,
  p_badge_number text default null,
  p_rank_title text default null,
  p_unit_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  new_department_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  insert into public.profiles (id, full_name, email)
  select
    auth_user.id,
    coalesce(
      nullif(auth_user.raw_user_meta_data ->> 'full_name', ''),
      nullif(auth_user.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(auth_user.email, 'TracePoint User'), '@', 1)
    ),
    auth_user.email
  from auth.users auth_user
  where auth_user.id = auth.uid()
  on conflict (id) do nothing;

  insert into public.departments (name, short_name, slug, created_by)
  values (p_name, p_short_name, p_slug, auth.uid())
  returning id into new_department_id;

  insert into public.department_memberships (
    department_id,
    user_id,
    badge_number,
    rank_title,
    unit_name
  )
  values (
    new_department_id,
    auth.uid(),
    p_badge_number,
    p_rank_title,
    p_unit_name
  );

  insert into public.department_membership_roles (
    department_id,
    user_id,
    role_code,
    assigned_by
  )
  values (
    new_department_id,
    auth.uid(),
    'administrator',
    auth.uid()
  );

  return new_department_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit trigger
-- ---------------------------------------------------------------------------

create or replace function public.write_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  old_json jsonb;
  new_json jsonb;
  tenant_id uuid;
  entity_uuid uuid;
begin
  old_json := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_json := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;

  tenant_id := coalesce(
    nullif(new_json ->> 'department_id', '')::uuid,
    nullif(old_json ->> 'department_id', '')::uuid
  );

  entity_uuid := coalesce(
    nullif(new_json ->> 'id', '')::uuid,
    nullif(old_json ->> 'id', '')::uuid
  );

  if tenant_id is not null then
    insert into public.audit_events (
      department_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      previous_value,
      new_value
    )
    values (
      tenant_id,
      auth.uid(),
      lower(tg_op),
      tg_table_name,
      entity_uuid,
      old_json,
      new_json
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger firearms_audit
after insert or update or delete on public.firearms
for each row execute function public.write_audit_event();

create trigger firearm_assignments_audit
after insert or update or delete on public.firearm_assignments
for each row execute function public.write_audit_event();

create trigger firearm_inspections_audit
after insert or update or delete on public.firearm_inspections
for each row execute function public.write_audit_event();

create trigger drill_templates_audit
after insert or update or delete on public.drill_templates
for each row execute function public.write_audit_event();

create trigger range_days_audit
after insert or update or delete on public.range_days
for each row execute function public.write_audit_event();

create trigger range_roster_audit
after insert or update or delete on public.range_day_roster
for each row execute function public.write_audit_event();

create trigger range_day_drills_audit
after insert or update or delete on public.range_day_drills
for each row execute function public.write_audit_event();

create trigger drill_results_audit
after insert or update or delete on public.drill_run_results
for each row execute function public.write_audit_event();

create trigger malfunctions_audit
after insert or update or delete on public.firearm_malfunctions
for each row execute function public.write_audit_event();

create trigger qualification_results_audit
after insert or update or delete on public.qualification_results
for each row execute function public.write_audit_event();

create trigger off_duty_requests_audit
after insert or update or delete on public.off_duty_firearm_requests
for each row execute function public.write_audit_event();

create trigger off_duty_actions_audit
after insert or update or delete on public.off_duty_request_actions
for each row execute function public.write_audit_event();

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

create view public.v_active_firearm_assignments
with (security_invoker = true)
as
select
  assignment.id,
  assignment.department_id,
  assignment.firearm_id,
  firearm.serial_number,
  firearm.make,
  firearm.model,
  firearm.caliber,
  firearm.firearm_type,
  assignment.assigned_to_user_id,
  profile.full_name as assigned_to_name,
  membership.badge_number,
  membership.rank_title,
  membership.unit_name,
  assignment.assigned_at
from public.firearm_assignments assignment
join public.firearms firearm
  on firearm.id = assignment.firearm_id
 and firearm.department_id = assignment.department_id
join public.profiles profile
  on profile.id = assignment.assigned_to_user_id
join public.department_memberships membership
  on membership.department_id = assignment.department_id
 and membership.user_id = assignment.assigned_to_user_id
where assignment.returned_at is null;

create view public.v_range_day_summary
with (security_invoker = true)
as
select
  range_day.id,
  range_day.department_id,
  range_day.title,
  range_day.range_date,
  range_day.location,
  range_day.status,
  range_day.range_type,
  range_day.packet_status,
  count(distinct roster.id) as roster_count,
  count(distinct roster.id) filter (
    where roster.attendance_status = 'present'
  ) as attended_count,
  count(distinct drill.id) as drill_count,
  count(distinct result.id) filter (
    where result.completed
  ) as completed_result_count
from public.range_days range_day
left join public.range_day_roster roster
  on roster.range_day_id = range_day.id
 and roster.department_id = range_day.department_id
left join public.range_day_drills drill
  on drill.range_day_id = range_day.id
 and drill.department_id = range_day.department_id
left join public.drill_run_results result
  on result.range_day_id = range_day.id
 and result.department_id = range_day.department_id
group by range_day.id;

create view public.v_latest_qualification_results
with (security_invoker = true)
as
select distinct on (
  result.department_id,
  result.officer_user_id,
  result.qualification_course_id,
  result.lighting_condition
)
  result.*
from public.qualification_results result
order by
  result.department_id,
  result.officer_user_id,
  result.qualification_course_id,
  result.lighting_condition,
  result.qualification_date desc,
  result.created_at desc;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.department_memberships enable row level security;
alter table public.department_membership_roles enable row level security;
alter table public.firearms enable row level security;
alter table public.firearm_assignments enable row level security;
alter table public.firearm_inspections enable row level security;
alter table public.drill_templates enable row level security;
alter table public.range_days enable row level security;
alter table public.range_day_instructors enable row level security;
alter table public.range_day_roster enable row level security;
alter table public.range_day_roster_firearms enable row level security;
alter table public.range_day_drills enable row level security;
alter table public.drill_run_results enable row level security;
alter table public.firearm_malfunctions enable row level security;
alter table public.qualification_courses enable row level security;
alter table public.qualification_course_versions enable row level security;
alter table public.qualification_results enable row level security;
alter table public.instructor_observations enable row level security;
alter table public.remedial_training_recommendations enable row level security;
alter table public.range_packets enable row level security;
alter table public.off_duty_firearm_requests enable row level security;
alter table public.off_duty_request_actions enable row level security;
alter table public.inbox_items enable row level security;
alter table public.alerts enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.department_memberships viewer_membership
    join public.department_memberships subject_membership
      on subject_membership.department_id = viewer_membership.department_id
    where viewer_membership.user_id = auth.uid()
      and viewer_membership.is_active
      and subject_membership.user_id = profiles.id
      and subject_membership.is_active
  )
);

create policy profiles_update_self
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy departments_select_member
on public.departments for select
to authenticated
using (public.is_department_member(id));

create policy departments_update_admin
on public.departments for update
to authenticated
using (public.has_department_permission(id, 'administer_department'))
with check (public.has_department_permission(id, 'administer_department'));

create policy roles_select_authenticated
on public.roles for select
to authenticated
using (true);

create policy permissions_select_authenticated
on public.permissions for select
to authenticated
using (true);

create policy role_permissions_select_authenticated
on public.role_permissions for select
to authenticated
using (true);

create policy memberships_select_member
on public.department_memberships for select
to authenticated
using (public.is_department_member(department_id));

create policy memberships_insert_admin
on public.department_memberships for insert
to authenticated
with check (
  public.has_department_permission(department_id, 'manage_users')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy memberships_update_admin
on public.department_memberships for update
to authenticated
using (
  public.has_department_permission(department_id, 'manage_users')
  or public.has_department_permission(department_id, 'administer_department')
)
with check (
  public.has_department_permission(department_id, 'manage_users')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy memberships_delete_admin
on public.department_memberships for delete
to authenticated
using (public.has_department_permission(department_id, 'administer_department'));

create policy membership_roles_select_member
on public.department_membership_roles for select
to authenticated
using (public.is_department_member(department_id));

create policy membership_roles_insert_admin
on public.department_membership_roles for insert
to authenticated
with check (
  public.has_department_permission(department_id, 'manage_users')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy membership_roles_delete_admin
on public.department_membership_roles for delete
to authenticated
using (
  public.has_department_permission(department_id, 'manage_users')
  or public.has_department_permission(department_id, 'administer_department')
);

-- Member-readable operational tables.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'firearms',
    'firearm_assignments',
    'firearm_inspections',
    'drill_templates',
    'range_days',
    'range_day_instructors',
    'range_day_roster',
    'range_day_roster_firearms',
    'range_day_drills',
    'drill_run_results',
    'firearm_malfunctions',
    'qualification_courses',
    'qualification_course_versions',
    'qualification_results',
    'instructor_observations',
    'remedial_training_recommendations',
    'range_packets',
    'alerts'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_department_member(department_id))',
      table_name || '_select_member',
      table_name
    );
  end loop;
end
$$;

-- Firearm administration.
create policy firearms_insert_manager
on public.firearms for insert to authenticated
with check (public.has_department_permission(department_id, 'manage_firearms'));

create policy firearms_update_manager
on public.firearms for update to authenticated
using (public.has_department_permission(department_id, 'manage_firearms'))
with check (public.has_department_permission(department_id, 'manage_firearms'));

create policy firearms_delete_admin
on public.firearms for delete to authenticated
using (public.has_department_permission(department_id, 'administer_department'));

create policy firearm_assignments_insert_manager
on public.firearm_assignments for insert to authenticated
with check (public.has_department_permission(department_id, 'manage_firearms'));

create policy firearm_assignments_update_manager
on public.firearm_assignments for update to authenticated
using (public.has_department_permission(department_id, 'manage_firearms'))
with check (public.has_department_permission(department_id, 'manage_firearms'));

create policy firearm_assignments_delete_admin
on public.firearm_assignments for delete to authenticated
using (public.has_department_permission(department_id, 'administer_department'));

create policy firearm_inspections_insert_manager
on public.firearm_inspections for insert to authenticated
with check (
  public.has_department_permission(department_id, 'manage_inspections')
  or public.has_department_permission(department_id, 'manage_firearms')
);

create policy firearm_inspections_update_manager
on public.firearm_inspections for update to authenticated
using (
  public.has_department_permission(department_id, 'manage_inspections')
  or public.has_department_permission(department_id, 'manage_firearms')
)
with check (
  public.has_department_permission(department_id, 'manage_inspections')
  or public.has_department_permission(department_id, 'manage_firearms')
);

create policy firearm_inspections_delete_admin
on public.firearm_inspections for delete to authenticated
using (public.has_department_permission(department_id, 'administer_department'));

create policy malfunctions_insert_member
on public.firearm_malfunctions for insert to authenticated
with check (
  public.is_department_member(department_id)
  and reported_by_user_id = auth.uid()
);

create policy malfunctions_update_manager
on public.firearm_malfunctions for update to authenticated
using (
  public.has_department_permission(department_id, 'manage_firearms')
  or public.has_department_permission(department_id, 'manage_inspections')
)
with check (
  public.has_department_permission(department_id, 'manage_firearms')
  or public.has_department_permission(department_id, 'manage_inspections')
);

create policy malfunctions_delete_admin
on public.firearm_malfunctions for delete to authenticated
using (public.has_department_permission(department_id, 'administer_department'));

-- Range planning.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'drill_templates',
    'range_days',
    'range_day_instructors',
    'range_day_roster',
    'range_day_roster_firearms',
    'range_day_drills',
    'range_packets'
  ]
  loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_department_permission(department_id, ''manage_range_days''))',
      table_name || '_insert_range_manager',
      table_name
    );

    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_department_permission(department_id, ''manage_range_days'')) with check (public.has_department_permission(department_id, ''manage_range_days''))',
      table_name || '_update_range_manager',
      table_name
    );

    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_department_permission(department_id, ''administer_department''))',
      table_name || '_delete_admin',
      table_name
    );
  end loop;
end
$$;

-- Scoring, observations, and remediation.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'drill_run_results',
    'instructor_observations',
    'remedial_training_recommendations'
  ]
  loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_department_permission(department_id, ''score_range_days'') or public.has_department_permission(department_id, ''manage_qualifications''))',
      table_name || '_insert_scorer',
      table_name
    );

    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_department_permission(department_id, ''score_range_days'') or public.has_department_permission(department_id, ''manage_qualifications'')) with check (public.has_department_permission(department_id, ''score_range_days'') or public.has_department_permission(department_id, ''manage_qualifications''))',
      table_name || '_update_scorer',
      table_name
    );

    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_department_permission(department_id, ''administer_department''))',
      table_name || '_delete_admin',
      table_name
    );
  end loop;
end
$$;

-- Qualification administration.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'qualification_courses',
    'qualification_course_versions',
    'qualification_results'
  ]
  loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_department_permission(department_id, ''manage_qualifications'') or public.has_department_permission(department_id, ''score_range_days''))',
      table_name || '_insert_qualification_manager',
      table_name
    );

    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_department_permission(department_id, ''manage_qualifications'') or public.has_department_permission(department_id, ''score_range_days'')) with check (public.has_department_permission(department_id, ''manage_qualifications'') or public.has_department_permission(department_id, ''score_range_days''))',
      table_name || '_update_qualification_manager',
      table_name
    );

    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_department_permission(department_id, ''administer_department''))',
      table_name || '_delete_admin',
      table_name
    );
  end loop;
end
$$;

-- Off-duty records: officers see their own; reviewers see the department queue.
create policy off_duty_requests_select
on public.off_duty_firearm_requests for select
to authenticated
using (
  officer_user_id = auth.uid()
  or public.has_department_permission(department_id, 'review_off_duty_requests')
);

create policy off_duty_requests_insert_owner
on public.off_duty_firearm_requests for insert
to authenticated
with check (
  officer_user_id = auth.uid()
  and public.has_department_permission(department_id, 'submit_off_duty_requests')
);

create policy off_duty_requests_update
on public.off_duty_firearm_requests for update
to authenticated
using (
  public.has_department_permission(department_id, 'review_off_duty_requests')
  or (
    officer_user_id = auth.uid()
    and request_status in ('draft', 'returned_for_correction')
  )
)
with check (
  public.has_department_permission(department_id, 'review_off_duty_requests')
  or officer_user_id = auth.uid()
);

create policy off_duty_requests_delete_draft
on public.off_duty_firearm_requests for delete
to authenticated
using (
  (
    officer_user_id = auth.uid()
    and request_status = 'draft'
  )
  or public.has_department_permission(department_id, 'administer_department')
);

create policy off_duty_actions_select
on public.off_duty_request_actions for select
to authenticated
using (
  exists (
    select 1
    from public.off_duty_firearm_requests request
    where request.id = off_duty_request_actions.request_id
      and request.department_id = off_duty_request_actions.department_id
      and (
        request.officer_user_id = auth.uid()
        or public.has_department_permission(request.department_id, 'review_off_duty_requests')
      )
  )
);

create policy off_duty_actions_insert
on public.off_duty_request_actions for insert
to authenticated
with check (
  performed_by_user_id = auth.uid()
  and (
    public.has_department_permission(department_id, 'review_off_duty_requests')
    or exists (
      select 1
      from public.off_duty_firearm_requests request
      where request.id = off_duty_request_actions.request_id
        and request.department_id = off_duty_request_actions.department_id
        and request.officer_user_id = auth.uid()
    )
  )
);

-- Unified inbox.
create policy inbox_items_select_target
on public.inbox_items for select
to authenticated
using (
  public.is_department_member(department_id)
  and (
    assigned_to_user_id = auth.uid()
    or (
      assigned_to_role_code is not null
      and public.has_department_role(
        department_id,
        array[assigned_to_role_code]
      )
    )
  )
);

create policy inbox_items_insert_workflow
on public.inbox_items for insert
to authenticated
with check (
  public.is_department_member(department_id)
  and (
    public.has_department_permission(department_id, 'manage_range_days')
    or public.has_department_permission(department_id, 'manage_firearms')
    or public.has_department_permission(department_id, 'review_off_duty_requests')
    or assigned_to_user_id = auth.uid()
  )
);

create policy inbox_items_update_target
on public.inbox_items for update
to authenticated
using (
  assigned_to_user_id = auth.uid()
  or (
    assigned_to_role_code is not null
    and public.has_department_role(department_id, array[assigned_to_role_code])
  )
)
with check (
  assigned_to_user_id = auth.uid()
  or (
    assigned_to_role_code is not null
    and public.has_department_role(department_id, array[assigned_to_role_code])
  )
);

create policy inbox_items_delete_admin
on public.inbox_items for delete
to authenticated
using (public.has_department_permission(department_id, 'administer_department'));

-- Alerts.
create policy alerts_insert_manager
on public.alerts for insert
to authenticated
with check (
  public.has_department_permission(department_id, 'view_command_dashboard')
  or public.has_department_permission(department_id, 'manage_firearms')
  or public.has_department_permission(department_id, 'manage_range_days')
);

create policy alerts_update_manager
on public.alerts for update
to authenticated
using (
  public.has_department_permission(department_id, 'view_command_dashboard')
  or assigned_to_user_id = auth.uid()
)
with check (
  public.has_department_permission(department_id, 'view_command_dashboard')
  or assigned_to_user_id = auth.uid()
);

create policy alerts_delete_admin
on public.alerts for delete
to authenticated
using (public.has_department_permission(department_id, 'administer_department'));

-- Audit is command-restricted and trigger-written.
create policy audit_events_select_authorized
on public.audit_events for select
to authenticated
using (public.has_department_permission(department_id, 'view_audit_log'));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select on public.roles to authenticated;
grant select on public.permissions to authenticated;
grant select on public.role_permissions to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke all on function public.is_department_member(uuid) from public;
revoke all on function public.has_department_role(uuid, text[]) from public;
revoke all on function public.has_department_permission(uuid, text) from public;
revoke all on function public.create_department_with_owner(
  text,
  text,
  text,
  text,
  text,
  text
) from public;

grant execute on function public.is_department_member(uuid) to authenticated;
grant execute on function public.has_department_role(uuid, text[]) to authenticated;
grant execute on function public.has_department_permission(uuid, text) to authenticated;
grant execute on function public.create_department_with_owner(
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

revoke all on function public.write_audit_event() from public;
revoke all on function public.handle_new_auth_user() from public;

-- Future tables must explicitly enable RLS and receive grants in a tracked migration.
