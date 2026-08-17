create table if not exists public.off_duty_firearm_inspections (
  id uuid primary key default gen_random_uuid(),

  department_id uuid not null
    references public.departments(id) on delete cascade,

  request_id uuid not null
    references public.off_duty_firearm_requests(id) on delete cascade,

  inspected_by_user_id uuid not null
    references auth.users(id) on delete restrict,

  inspection_date date not null,
  result text not null
    check (result in ('Pass', 'Fail')),

  notes text,
  created_at timestamptz not null default now()
);

create index if not exists off_duty_firearm_inspections_request_idx
  on public.off_duty_firearm_inspections (
    department_id,
    request_id,
    inspection_date desc,
    created_at desc
  );

alter table public.off_duty_firearm_inspections
  enable row level security;
