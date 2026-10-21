-- Read-only snapshot of the inputs to qualification readiness, one JSON document
-- for every agency (or one: psql -v department_id=<uuid>). Feed the output to
-- scripts/qualification-status-diff.mjs. Contains officer names and scores:
-- keep the file inside the authorised environment and delete it afterwards.
--   psql "$DATABASE_URL" -X -At -v department_id= -f scripts/qualification-status-snapshot.sql > snapshot.json
\set QUIET on
begin transaction read only;
select json_build_object('generatedAt', now(), 'departments', coalesce(json_agg(agency order by agency.name), '[]'::json))
from (
  select
    department.id as "departmentId",
    department.name,
    (select workspace from public.pilot_range_workspaces where department_id = department.id) as workspace,
    (select coalesce(json_agg(json_build_object(
        'id', result.id, 'officer_user_id', result.officer_user_id, 'qualification_date', result.qualification_date,
        'lighting_condition', result.lighting_condition, 'score', result.score, 'passed', result.passed, 'expires_on', result.expires_on)), '[]'::json)
      from public.qualification_results result where result.department_id = department.id) as "qualificationResults",
    (select coalesce(json_agg(json_build_object('id', standard.id, 'name', standard.name, 'firearmType', standard.firearm_type,
        'components', (select coalesce(json_agg(json_build_object('name', component.name, 'isRequired', component.is_required)), '[]'::json)
          from public.department_qualification_standard_components component
          where component.qualification_standard_id = standard.id and component.department_id = department.id and component.is_active))), '[]'::json)
      from public.department_qualification_standards standard where standard.department_id = department.id and standard.is_active) as "qualificationStandards",
    (select json_build_object('qualification_valid_days', rules.qualification_valid_days, 'qualification_due_soon_days', rules.qualification_due_soon_days,
        'range_qualification_rules', rules.range_qualification_rules)
      from public.department_rules rules where rules.department_id = department.id) as rules,
    (select coalesce(json_agg(json_build_object('userId', membership.user_id, 'name', coalesce(profile.full_name, profile.email, membership.user_id::text))), '[]'::json)
      from public.department_memberships membership left join public.profiles profile on profile.id = membership.user_id
      where membership.department_id = department.id and membership.is_active) as personnel
  from public.departments department
  where coalesce(nullif(:'department_id', ''), department.id::text) = department.id::text
) agency;
rollback;
