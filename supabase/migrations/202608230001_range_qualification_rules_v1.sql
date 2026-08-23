-- TracePoint
-- Range & Qualifications Agency Rules V1
--
-- Adds an extensible module-level policy contract while retaining
-- existing scalar department_rules columns for backward compatibility.

alter table public.department_rules
  add column if not exists range_qualification_rules jsonb
  not null
  default '{
    "schema_version": 1,
    "require_day_handgun_qualification": true,
    "require_night_handgun_qualification": true,
    "require_rifle_qualification": false,
    "require_rifle_familiarization": false,
    "rifle_familiarization_valid_days": 365,
    "rifle_familiarization_due_soon_days": 30,
    "rifle_familiarization_affects_readiness": true,
    "qualification_failure_requires_remediation": true,
    "remediation_due_days": 30,
    "missing_required_qualification_affects_readiness": true,
    "expired_qualification_affects_readiness": true
  }'::jsonb;

-- Seed the new contract from the existing familiarization rule so
-- existing agency configuration is not lost.
update public.department_rules
set range_qualification_rules =
  jsonb_set(
    range_qualification_rules,
    '{require_rifle_familiarization}',
    to_jsonb(require_rifle_familiarization),
    true
  );

alter table public.department_rules
  drop constraint if exists department_rules_range_qualification_rules_object;

alter table public.department_rules
  add constraint department_rules_range_qualification_rules_object
  check (jsonb_typeof(range_qualification_rules) = 'object');

comment on column public.department_rules.range_qualification_rules is
  'Versioned department-specific Range and Qualification policy contract used by TracePoint readiness and workflow services.';