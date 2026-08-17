create table if not exists public.off_duty_firearm_requests (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  officer_user_id uuid not null references auth.users(id) on delete restrict,

  make text not null,
  model text not null,
  firearm_type text not null,
  serial_number text not null,
  caliber text not null,
  capacity text,
  optic text,
  weapon_light text,
  holster text,

  proof_ownership boolean not null default false,
  qualification_reviewed boolean not null default false,
  inspection_reviewed boolean not null default false,
  policy_acknowledged boolean not null default false,
  officer_notes text,

  request_status text not null default 'Pending Command Review'
    check (
      request_status in (
        'Draft',
        'Pending Command Review',
        'Returned for Correction',
        'Approved',
        'Denied',
        'Withdrawn'
      )
    ),

  authorization_status text not null default 'Not Authorized'
    check (
      authorization_status in (
        'Not Authorized',
        'Authorized',
        'Expiring Soon',
        'Expired',
        'Revoked'
      )
    ),

  inspection_status text not null default 'Due Soon'
    check (
      inspection_status in (
        'Current',
        'Due Soon',
        'Overdue'
      )
    ),

  compliance_status text not null default 'At Risk'
    check (
      compliance_status in (
        'Authorized',
        'At Risk',
        'Non-Compliant'
      )
    ),

  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  approval_effective_date date,
  approval_expiration_date date,
  decision_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (department_id, serial_number)
);

create index if not exists off_duty_firearm_requests_department_idx
  on public.off_duty_firearm_requests (department_id);

create index if not exists off_duty_firearm_requests_officer_idx
  on public.off_duty_firearm_requests (department_id, officer_user_id);

create index if not exists off_duty_firearm_requests_status_idx
  on public.off_duty_firearm_requests (department_id, request_status);

create table if not exists public.off_duty_firearm_history (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  request_id uuid not null references public.off_duty_firearm_requests(id) on delete cascade,
  action text not null
    check (
      action in (
        'Submitted',
        'Resubmitted',
        'Approved',
        'Denied',
        'Returned for Correction',
        'Revoked'
      )
    ),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_name text not null,
  actor_role text not null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists off_duty_firearm_history_request_idx
  on public.off_duty_firearm_history (department_id, request_id, created_at desc);

alter table public.off_duty_firearm_requests enable row level security;
alter table public.off_duty_firearm_history enable row level security;
