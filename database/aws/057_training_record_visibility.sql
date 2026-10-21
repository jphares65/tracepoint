begin;

-- TRN-26 / RNG-28: officers read their own training, certification, range and
-- qualification records; other officers' records are readable only with a
-- permission whose responsibility covers them (administer_department covers
-- all). The read sets match the API filters in
-- src/lib/tracepoint/training-record-visibility.ts, widened only where an
-- already-gated summary (readiness, command dashboard, performance summary,
-- training alerts) reads department-wide rows. Tenant scoping is unchanged.
-- Idempotent.

-- Certifications.
drop policy if exists "department members can view training certifications" on public.training_certifications;
drop policy if exists training_certifications_select_own_or_authorized on public.training_certifications;
create policy training_certifications_select_own_or_authorized
on public.training_certifications for select to authenticated
using (
  (user_id = tracepoint_auth.subject_id() and public.is_department_member(department_id))
  or public.has_any_department_permission(department_id,
    array['manage_certifications', 'view_command_dashboard', 'view_analytics', 'administer_department'])
);

-- Agency training rosters, attendance and outcomes.
drop policy if exists "department members can view agency training attendees" on public.agency_training_attendees;
drop policy if exists agency_training_attendees_select_own_or_authorized on public.agency_training_attendees;
create policy agency_training_attendees_select_own_or_authorized
on public.agency_training_attendees for select to authenticated
using (
  (user_id = tracepoint_auth.subject_id() and public.is_department_member(department_id))
  or public.has_any_department_permission(department_id,
    array['manage_training', 'view_command_dashboard', 'administer_department'])
);

drop policy if exists "department members can view agency training requirement members" on public.agency_training_requirement_members;
drop policy if exists agency_training_requirement_members_select_own_or_authorized on public.agency_training_requirement_members;
create policy agency_training_requirement_members_select_own_or_authorized
on public.agency_training_requirement_members for select to authenticated
using (
  (user_id = tracepoint_auth.subject_id() and public.is_department_member(department_id))
  or public.has_any_department_permission(department_id,
    array['manage_training', 'view_command_dashboard', 'administer_department'])
);

drop policy if exists "department members can view agency training certificates" on public.agency_training_certificates;
drop policy if exists agency_training_certificates_select_own_or_authorized on public.agency_training_certificates;
create policy agency_training_certificates_select_own_or_authorized
on public.agency_training_certificates for select to authenticated
using (
  (user_id = tracepoint_auth.subject_id() and public.is_department_member(department_id))
  or public.has_any_department_permission(department_id,
    array['manage_training', 'administer_department'])
);

-- Range and qualification records.
drop policy if exists qualification_results_select_member on public.qualification_results;
drop policy if exists qualification_results_select_own_or_authorized on public.qualification_results;
create policy qualification_results_select_own_or_authorized
on public.qualification_results for select to authenticated
using (
  (officer_user_id = tracepoint_auth.subject_id() and public.is_department_member(department_id))
  or public.has_any_department_permission(department_id,
    array['manage_qualifications', 'manage_range_days', 'score_range_days', 'manage_training',
          'view_analytics', 'view_command_dashboard', 'administer_department'])
);

drop policy if exists drill_run_results_select_member on public.drill_run_results;
drop policy if exists drill_run_results_select_own_or_authorized on public.drill_run_results;
create policy drill_run_results_select_own_or_authorized
on public.drill_run_results for select to authenticated
using (
  (officer_user_id = tracepoint_auth.subject_id() and public.is_department_member(department_id))
  or public.has_any_department_permission(department_id,
    array['manage_qualifications', 'manage_range_days', 'score_range_days', 'manage_training',
          'view_analytics', 'view_command_dashboard', 'administer_department'])
);

drop policy if exists range_day_roster_select_member on public.range_day_roster;
drop policy if exists range_day_roster_select_own_or_authorized on public.range_day_roster;
create policy range_day_roster_select_own_or_authorized
on public.range_day_roster for select to authenticated
using (
  (officer_user_id = tracepoint_auth.subject_id() and public.is_department_member(department_id))
  or public.has_any_department_permission(department_id,
    array['manage_qualifications', 'manage_range_days', 'score_range_days', 'manage_training',
          'view_analytics', 'view_command_dashboard', 'administer_department'])
);

drop policy if exists remedial_training_recommendations_select_member on public.remedial_training_recommendations;
drop policy if exists remedial_training_recommendations_select_own_or_authorized on public.remedial_training_recommendations;
create policy remedial_training_recommendations_select_own_or_authorized
on public.remedial_training_recommendations for select to authenticated
using (
  (officer_user_id = tracepoint_auth.subject_id() and public.is_department_member(department_id))
  or public.has_any_department_permission(department_id,
    array['manage_qualifications', 'manage_range_days', 'score_range_days', 'manage_training',
          'view_analytics', 'view_command_dashboard', 'administer_department'])
);

-- A generated packet holds every rostered officer's sheets.
drop policy if exists range_packets_select_member on public.range_packets;
drop policy if exists range_packets_select_authorized on public.range_packets;
create policy range_packets_select_authorized
on public.range_packets for select to authenticated
using (
  public.has_any_department_permission(department_id,
    array['manage_qualifications', 'manage_range_days', 'score_range_days', 'manage_training',
          'view_analytics', 'view_command_dashboard', 'administer_department'])
);

-- Qualification evidence: the result's officer, the uploader, or the
-- permissions the download route already accepts. Other attachment kinds keep
-- the department-member read.
drop policy if exists attachments_select on public.attachments;
create policy attachments_select
on public.attachments for select to authenticated
using (
  public.is_department_member(department_id)
  and (
    entity_type <> 'qualification'
    or uploaded_by_user_id = tracepoint_auth.subject_id()
    or public.has_any_department_permission(department_id,
      array['manage_qualifications', 'manage_range_days', 'score_range_days', 'view_analytics', 'administer_department'])
    or exists (
      select 1
      from public.pilot_range_workspaces workspace
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(workspace.workspace -> 'results') = 'array'
          then workspace.workspace -> 'results' else '[]'::jsonb end) result
      where workspace.department_id = attachments.department_id
        and result ->> 'id' = attachments.entity_key
        and coalesce(result ->> 'officerId', result ->> 'officerUserId', result ->> 'officer_user_id', result ->> 'officer_id')
          = tracepoint_auth.subject_id()::text
    )
  )
);

commit;
