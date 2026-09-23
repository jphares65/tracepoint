begin;

-- The AWS runtime assumes authenticated for application reads. audit_log was
-- created after the original blanket grants and never received an RLS policy.
-- Match the existing audit_events read boundary without granting direct writes.
alter table public.audit_log enable row level security;

create policy audit_log_select_authorized
on public.audit_log for select to authenticated
using (
  public.has_any_department_permission(
    department_id,
    array['view_audit_log', 'administer_department']
  )
);

grant select on public.audit_log to authenticated;

commit;
