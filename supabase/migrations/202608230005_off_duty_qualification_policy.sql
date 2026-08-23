alter table public.department_rules
  add column if not exists require_off_duty_qualification boolean
  not null
  default true;

comment on column public.department_rules.require_off_duty_qualification is
  'When true, an officer must have a current qualifying record before an off-duty firearm may be approved. When false, independent qualification does not block approval.';