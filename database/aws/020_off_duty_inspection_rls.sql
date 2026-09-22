begin;

-- The off-duty inspection table was introduced after the source lineage's
-- authenticated grants and enabled RLS without a policy. Request owners may
-- read their own inspection history; department inspection/review authorities
-- retain the existing granular command workflow.
create policy off_duty_inspections_read
on public.off_duty_firearm_inspections for select to authenticated
using (
  public.has_any_department_permission(
    department_id,
    array['manage_inspections', 'manage_firearms', 'review_off_duty_requests', 'administer_department']
  )
  or exists (
    select 1 from public.off_duty_firearm_requests request
    where request.id = off_duty_firearm_inspections.request_id
      and request.department_id = off_duty_firearm_inspections.department_id
      and request.officer_user_id = tracepoint_auth.subject_id()
  )
);

grant select on table public.off_duty_firearm_inspections to authenticated;

commit;
