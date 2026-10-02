begin;

-- Migration 023 is recorded in the staging ledger but was not executed while
-- that ledger was baselined. Restore its complete read boundary: RLS plus the
-- same department-permission policy and the required table privilege.
alter table public.audit_log enable row level security;

drop policy if exists audit_log_select_authorized on public.audit_log;
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
