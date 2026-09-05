-- Checklist rows inherit tenant visibility from their RLS-protected parent.
-- Enable RLS before granting the two operations used by the application.
alter table public.firearm_inspection_items enable row level security;
revoke all on public.firearm_inspection_items from anon,authenticated;
create policy inspection_checklist_parent_read on public.firearm_inspection_items
 for select to authenticated using(exists(
  select 1 from public.firearm_inspections i where i.id=inspection_id
  and public.is_department_member(i.department_id)
 ));
create policy inspection_checklist_manager_insert on public.firearm_inspection_items
 for insert to authenticated with check(exists(
  select 1 from public.firearm_inspections i where i.id=inspection_id
  and (public.has_department_permission(i.department_id,'manage_inspections')
   or public.has_department_permission(i.department_id,'manage_firearms'))
 ));
grant select,insert on public.firearm_inspection_items to authenticated;
notify pgrst, 'reload schema';
