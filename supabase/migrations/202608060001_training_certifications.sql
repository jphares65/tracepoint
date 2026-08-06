create table if not exists public.training_certifications (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  certification_title text not null,
  issuing_organization text,
  credential_number text,
  issue_date date,
  expiration_date date,
  reminder_days integer[] not null default array[180,90,60,30,14,7,0],
  notes text,
  document_url text,
  is_active boolean not null default true,
  created_by_user_id uuid references auth.users(id),
  updated_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_certifications_title_not_blank check (length(trim(certification_title)) > 0),
  constraint training_certifications_expiration_after_issue check (
    expiration_date is null or issue_date is null or expiration_date >= issue_date
  )
);

create index if not exists training_certifications_department_idx
  on public.training_certifications(department_id, is_active, expiration_date);
create index if not exists training_certifications_user_idx
  on public.training_certifications(department_id, user_id, is_active);

alter table public.training_certifications enable row level security;

create policy "department members can view training certifications"
  on public.training_certifications for select
  using (public.is_department_member(department_id));

create policy "training managers can insert certifications"
  on public.training_certifications for insert
  with check (
    public.has_department_permission(department_id, 'manage_qualifications')
    or public.has_department_permission(department_id, 'administer_department')
  );

create policy "training managers can update certifications"
  on public.training_certifications for update
  using (
    public.has_department_permission(department_id, 'manage_qualifications')
    or public.has_department_permission(department_id, 'administer_department')
  )
  with check (
    public.has_department_permission(department_id, 'manage_qualifications')
    or public.has_department_permission(department_id, 'administer_department')
  );

create policy "training managers can delete certifications"
  on public.training_certifications for delete
  using (
    public.has_department_permission(department_id, 'manage_qualifications')
    or public.has_department_permission(department_id, 'administer_department')
  );
