-- Complete the clean-bootstrap armory contract. Never infer historical mappings.
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='firearms' and column_name='condition_status')
    and exists(select 1 from public.firearms) then
  raise exception 'Armory legacy data requires an explicit reviewed condition/archive mapping before this migration';
 end if;
end $$;
alter table public.firearms
 add column if not exists condition_status text not null default 'In Service',
 add column if not exists is_active boolean not null default true,
 add column if not exists archived_at timestamptz,
 add column if not exists archived_by_user_id uuid references auth.users(id) on delete set null,
 add column if not exists archive_reason text;
alter table public.firearm_assignments
 add column if not exists condition_at_issue text,
 add column if not exists condition_at_return text,
 add column if not exists returned_by_user_id uuid references auth.users(id) on delete set null;
-- Current handlers store detailed inspection_reason; retain the old required
-- enum as an explicitly unspecified category for new writes only.
alter table public.firearm_inspections alter column reason set default 'other';
notify pgrst, 'reload schema';
