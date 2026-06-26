-- TracePoint least-privilege role matrix
-- Apply in Supabase SQL Editor before testing non-administrator roles.

begin;

delete from public.role_permissions;

insert into public.role_permissions (
  role_code,
  permission_code
) values
  -- Officer: personal workflows only.
  ('officer', 'submit_off_duty_requests'),

  -- Instructor: score assigned training and qualifications.
  ('instructor', 'score_range_days'),
  ('instructor', 'submit_off_duty_requests'),

  -- Range Master: owns the complete training workflow.
  ('range_master', 'manage_range_days'),
  ('range_master', 'score_range_days'),
  ('range_master', 'manage_qualifications'),
  ('range_master', 'view_analytics'),
  ('range_master', 'submit_off_duty_requests'),

  -- Armorer: owns department firearms and inspections.
  ('armorer', 'manage_firearms'),
  ('armorer', 'manage_inspections'),
  ('armorer', 'view_analytics'),
  ('armorer', 'submit_off_duty_requests'),

  -- Supervisor: oversight without automatically granting specialty duties.
  ('supervisor', 'view_analytics'),
  ('supervisor', 'submit_off_duty_requests'),

  -- Command Staff: command visibility and approval authority.
  ('command_staff', 'view_command_dashboard'),
  ('command_staff', 'view_analytics'),
  ('command_staff', 'review_off_duty_requests'),
  ('command_staff', 'view_audit_log'),
  ('command_staff', 'submit_off_duty_requests'),

  -- Chief: command authority and user administration.
  ('chief', 'view_command_dashboard'),
  ('chief', 'view_analytics'),
  ('chief', 'manage_users'),
  ('chief', 'review_off_duty_requests'),
  ('chief', 'view_audit_log'),
  ('chief', 'submit_off_duty_requests'),

  -- Administrator: complete configuration and operational access.
  ('administrator', 'view_command_dashboard'),
  ('administrator', 'view_analytics'),
  ('administrator', 'manage_users'),
  ('administrator', 'manage_firearms'),
  ('administrator', 'manage_inspections'),
  ('administrator', 'manage_range_days'),
  ('administrator', 'score_range_days'),
  ('administrator', 'manage_qualifications'),
  ('administrator', 'review_off_duty_requests'),
  ('administrator', 'view_audit_log'),
  ('administrator', 'submit_off_duty_requests'),
  ('administrator', 'administer_department');

commit;

select
  role.display_name as role,
  permission.display_name as permission
from public.role_permissions role_permission
join public.roles role
  on role.code = role_permission.role_code
join public.permissions permission
  on permission.code = role_permission.permission_code
order by role.sort_order, permission.display_name;
