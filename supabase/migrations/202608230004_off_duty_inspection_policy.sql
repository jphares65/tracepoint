alter table public.department_rules
  add column if not exists require_off_duty_inspection boolean
  not null
  default true;

comment on column public.department_rules.require_off_duty_inspection is
  'When true, an off-duty firearm must have a current passing department inspection before approval. When false, inspection is optional and does not block approval.';