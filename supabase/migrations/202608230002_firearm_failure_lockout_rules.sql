-- TracePoint
-- Firearm Qualification Failure Restriction Rules
--
-- Extends the Range & Qualifications policy contract.
--
-- Important:
-- This policy affects the officer/firearm authorization relationship.
-- It does NOT change the operational/mechanical status of the firearm.

alter table public.department_rules
  add column if not exists range_qualification_rules jsonb
  not null
  default '{}'::jsonb;

update public.department_rules
set range_qualification_rules =
  '{
    "firearm_failure_lockout_enabled": true,
    "firearm_failure_lockout_threshold": 2,
    "firearm_failure_count_mode": "consecutive_since_pass",
    "firearm_failure_scope": "specific_firearm",
    "passing_requalification_restores_authorization": true,
    "require_supervisor_release_after_requalification": false
  }'::jsonb
  ||
  coalesce(range_qualification_rules, '{}'::jsonb);

comment on column public.department_rules.range_qualification_rules is
  'Versioned department-specific Range and Qualification policy contract, including officer/firearm qualification restriction behavior.';