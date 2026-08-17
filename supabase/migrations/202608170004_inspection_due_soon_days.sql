alter table public.department_rules
  add column if not exists inspection_due_soon_days integer not null default 30;

alter table public.department_rules
  drop constraint if exists department_rules_inspection_due_soon_days_check;

alter table public.department_rules
  add constraint department_rules_inspection_due_soon_days_check
  check (inspection_due_soon_days >= 0);
