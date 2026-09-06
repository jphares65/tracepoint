-- Retire the six production-only Training Alerts/remediation permission codes
-- reviewed on feature/legacy-permission-audit-20260905. No legacy assignment
-- is translated into a broader grant.

begin;

create table if not exists public.retired_permission_assignment_audit (
  id bigint generated always as identity primary key,
  permission_code text not null,
  record_scope text not null check (
    record_scope in ('catalog', 'global_role_default', 'department_role')
  ),
  department_id uuid,
  role_code text,
  display_name text,
  description text,
  granted_by uuid,
  granted_at timestamptz,
  retired_at timestamptz not null default now(),
  replacement_permission_code text,
  retirement_reason text not null,
  snapshot jsonb not null default '{}'::jsonb
);

create unique index if not exists retired_permission_assignment_audit_identity_uidx
on public.retired_permission_assignment_audit (
  permission_code,
  record_scope,
  coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(role_code, '')
);

comment on table public.retired_permission_assignment_audit is
  'Immutable snapshot of permission catalog and assignment rows retired after authorization audits.';

alter table public.retired_permission_assignment_audit enable row level security;
revoke all on table public.retired_permission_assignment_audit from anon, authenticated;
grant select on table public.retired_permission_assignment_audit to service_role;

with legacy(code, replacement_code, reason) as (
  values
    ('create_remediations', 'manage_training', 'Pilot remediation creation is enforced by manage_training; no automatic broader grant is safe.'),
    ('manage_remediations', 'manage_training', 'Pilot remediation assignment, notes, and status changes are enforced by manage_training; no automatic broader grant is safe.'),
    ('resolve_remediations', 'manage_training', 'Pilot remediation completion is enforced by manage_training; no automatic broader grant is safe.'),
    ('view_training_alerts', 'view_analytics', 'The generated Training Alerts feed is enforced by view_analytics; routed alert visibility is not implemented.'),
    ('manage_training_alerts', null, 'Server-persisted alert acknowledgement, assignment, dismissal, escalation, and resolution are not implemented.'),
    ('view_command_training_alerts', null, 'A distinct command-only high-severity or escalated Training Alerts view is not implemented.')
)
insert into public.retired_permission_assignment_audit (
  permission_code, record_scope, display_name, description,
  replacement_permission_code, retirement_reason, snapshot
)
select
  permission.code, 'catalog', permission.display_name, permission.description,
  legacy.replacement_code, legacy.reason,
  jsonb_build_object(
    'code', permission.code,
    'display_name', permission.display_name,
    'description', permission.description
  )
from public.permissions permission
join legacy on legacy.code = permission.code
on conflict do nothing;

with legacy(code, replacement_code, reason) as (
  values
    ('create_remediations', 'manage_training', 'Pilot remediation creation is enforced by manage_training; no automatic broader grant is safe.'),
    ('manage_remediations', 'manage_training', 'Pilot remediation assignment, notes, and status changes are enforced by manage_training; no automatic broader grant is safe.'),
    ('resolve_remediations', 'manage_training', 'Pilot remediation completion is enforced by manage_training; no automatic broader grant is safe.'),
    ('view_training_alerts', 'view_analytics', 'The generated Training Alerts feed is enforced by view_analytics; routed alert visibility is not implemented.'),
    ('manage_training_alerts', null, 'Server-persisted alert acknowledgement, assignment, dismissal, escalation, and resolution are not implemented.'),
    ('view_command_training_alerts', null, 'A distinct command-only high-severity or escalated Training Alerts view is not implemented.')
)
insert into public.retired_permission_assignment_audit (
  permission_code, record_scope, role_code,
  replacement_permission_code, retirement_reason, snapshot
)
select
  assignment.permission_code, 'global_role_default', assignment.role_code,
  legacy.replacement_code, legacy.reason,
  jsonb_build_object(
    'role_code', assignment.role_code,
    'permission_code', assignment.permission_code
  )
from public.role_permissions assignment
join legacy on legacy.code = assignment.permission_code
on conflict do nothing;

with legacy(code, replacement_code, reason) as (
  values
    ('create_remediations', 'manage_training', 'Pilot remediation creation is enforced by manage_training; no automatic broader grant is safe.'),
    ('manage_remediations', 'manage_training', 'Pilot remediation assignment, notes, and status changes are enforced by manage_training; no automatic broader grant is safe.'),
    ('resolve_remediations', 'manage_training', 'Pilot remediation completion is enforced by manage_training; no automatic broader grant is safe.'),
    ('view_training_alerts', 'view_analytics', 'The generated Training Alerts feed is enforced by view_analytics; routed alert visibility is not implemented.'),
    ('manage_training_alerts', null, 'Server-persisted alert acknowledgement, assignment, dismissal, escalation, and resolution are not implemented.'),
    ('view_command_training_alerts', null, 'A distinct command-only high-severity or escalated Training Alerts view is not implemented.')
)
insert into public.retired_permission_assignment_audit (
  permission_code, record_scope, department_id, role_code,
  granted_by, granted_at, replacement_permission_code,
  retirement_reason, snapshot
)
select
  assignment.permission_code, 'department_role', assignment.department_id,
  assignment.role_code, assignment.granted_by, assignment.granted_at,
  legacy.replacement_code, legacy.reason,
  jsonb_build_object(
    'department_id', assignment.department_id,
    'role_code', assignment.role_code,
    'permission_code', assignment.permission_code,
    'granted_by', assignment.granted_by,
    'granted_at', assignment.granted_at
  )
from public.department_role_permissions assignment
join legacy on legacy.code = assignment.permission_code
on conflict do nothing;

delete from public.department_role_permissions
where permission_code in (
  'create_remediations',
  'manage_remediations',
  'resolve_remediations',
  'view_training_alerts',
  'manage_training_alerts',
  'view_command_training_alerts'
);

delete from public.role_permissions
where permission_code in (
  'create_remediations',
  'manage_remediations',
  'resolve_remediations',
  'view_training_alerts',
  'manage_training_alerts',
  'view_command_training_alerts'
);

delete from public.permissions
where code in (
  'create_remediations',
  'manage_remediations',
  'resolve_remediations',
  'view_training_alerts',
  'manage_training_alerts',
  'view_command_training_alerts'
);

commit;
