-- TracePoint Training Alerts permission hardening
-- Run this in Supabase SQL Editor.

insert into permissions (code, name, description, category)
values
  (
    'view_training_alerts',
    'View Training Alerts',
    'View training alerts routed to the user, role, or command group.',
    'training'
  ),
  (
    'manage_training_alerts',
    'Manage Training Alerts',
    'Acknowledge, assign, resolve, dismiss, or escalate training alerts.',
    'training'
  ),
  (
    'create_remediations',
    'Create Remediations',
    'Create remediation records from qualification failures, drill trends, or instructor concerns.',
    'training'
  ),
  (
    'manage_remediations',
    'Manage Remediations',
    'Assign, update, document, and manage remediation records.',
    'training'
  ),
  (
    'resolve_remediations',
    'Resolve Remediations',
    'Close remediation records after successful completion or administrative resolution.',
    'training'
  ),
  (
    'view_command_training_alerts',
    'View Command Training Alerts',
    'View high-severity, escalated, and command-visible training alerts.',
    'training'
  )
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category;

with role_permission_pairs(role_code, permission_code) as (
  values
    ('system_admin', 'view_training_alerts'),
    ('system_admin', 'manage_training_alerts'),
    ('system_admin', 'create_remediations'),
    ('system_admin', 'manage_remediations'),
    ('system_admin', 'resolve_remediations'),
    ('system_admin', 'view_command_training_alerts'),

    ('agency_admin', 'view_training_alerts'),
    ('agency_admin', 'manage_training_alerts'),
    ('agency_admin', 'create_remediations'),
    ('agency_admin', 'manage_remediations'),
    ('agency_admin', 'resolve_remediations'),
    ('agency_admin', 'view_command_training_alerts'),

    ('administrator', 'view_training_alerts'),
    ('administrator', 'manage_training_alerts'),
    ('administrator', 'create_remediations'),
    ('administrator', 'manage_remediations'),
    ('administrator', 'resolve_remediations'),
    ('administrator', 'view_command_training_alerts'),

    ('command_staff', 'view_training_alerts'),
    ('command_staff', 'view_command_training_alerts'),
    ('command_staff', 'manage_training_alerts'),
    ('command_staff', 'resolve_remediations'),

    ('chief', 'view_training_alerts'),
    ('chief', 'view_command_training_alerts'),
    ('chief', 'manage_training_alerts'),
    ('chief', 'resolve_remediations'),

    ('executive_command', 'view_training_alerts'),
    ('executive_command', 'view_command_training_alerts'),
    ('executive_command', 'manage_training_alerts'),
    ('executive_command', 'resolve_remediations'),

    ('training_supervisor', 'view_training_alerts'),
    ('training_supervisor', 'manage_training_alerts'),
    ('training_supervisor', 'create_remediations'),
    ('training_supervisor', 'manage_remediations'),
    ('training_supervisor', 'resolve_remediations'),
    ('training_supervisor', 'view_command_training_alerts'),

    ('range_master', 'view_training_alerts'),
    ('range_master', 'manage_training_alerts'),
    ('range_master', 'create_remediations'),
    ('range_master', 'manage_remediations'),
    ('range_master', 'resolve_remediations'),

    ('firearms_instructor', 'view_training_alerts'),
    ('firearms_instructor', 'manage_training_alerts'),
    ('firearms_instructor', 'create_remediations'),
    ('firearms_instructor', 'manage_remediations'),

    ('instructor', 'view_training_alerts'),
    ('instructor', 'manage_training_alerts'),
    ('instructor', 'create_remediations'),
    ('instructor', 'manage_remediations')
)
insert into role_permissions (role_code, permission_code)
select pairs.role_code, pairs.permission_code
from role_permission_pairs pairs
join roles on roles.code = pairs.role_code
join permissions on permissions.code = pairs.permission_code
on conflict do nothing;

select
  rp.role_code,
  rp.permission_code
from role_permissions rp
where rp.permission_code in (
  'view_training_alerts',
  'manage_training_alerts',
  'create_remediations',
  'manage_remediations',
  'resolve_remediations',
  'view_command_training_alerts'
)
order by rp.role_code, rp.permission_code;
