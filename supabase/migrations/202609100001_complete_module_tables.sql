begin;

create table if not exists public.ammunition_lots (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  category text not null check (category in ('Duty','Training')),
  caliber text not null check (length(btrim(caliber)) between 1 and 100),
  manufacturer text not null check (length(btrim(manufacturer)) between 1 and 200),
  load_description text,
  lot_number text not null check (length(btrim(lot_number)) between 1 and 200),
  purchase_date date,
  cost_per_round numeric(12,4) check (cost_per_round is null or cost_per_round >= 0),
  low_stock_threshold integer not null default 0 check (low_stock_threshold >= 0),
  replacement_due_date date,
  recall_flag boolean not null default false,
  notes text,
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, lot_number)
);

create table if not exists public.ammunition_transactions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  lot_id uuid not null references public.ammunition_lots(id) on delete restrict,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  category text not null check (category in ('Duty','Training')),
  transaction_type text not null check (transaction_type in ('Receive','Issue','Return','Adjust')),
  quantity integer not null check (quantity > 0),
  quantity_change integer not null check (quantity_change <> 0),
  recipient_type text,
  recipient_name text,
  reference text,
  reason text,
  notes text,
  transaction_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.ammunition_reconciliations (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  cycle_name text not null check (length(btrim(cycle_name)) between 1 and 100),
  cycle_year integer not null check (cycle_year between 2000 and 2200),
  cycle_start date not null,
  cycle_end date not null,
  status text not null default 'Draft' check (status in ('Draft','Submitted','Certified')),
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  submitted_by uuid references public.profiles(id) on delete restrict,
  certified_by uuid references public.profiles(id) on delete restrict,
  submitted_at timestamptz,
  certified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cycle_end >= cycle_start),
  unique (department_id, cycle_name, cycle_year)
);

create table if not exists public.ammunition_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.ammunition_reconciliations(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  lot_id uuid not null references public.ammunition_lots(id) on delete restrict,
  expected_quantity integer not null check (expected_quantity >= 0),
  physical_quantity integer check (physical_quantity is null or physical_quantity >= 0),
  variance integer,
  explanation text,
  created_at timestamptz not null default now(),
  check (variance is not distinct from case when physical_quantity is null then null else physical_quantity - expected_quantity end),
  unique (reconciliation_id, lot_id)
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  entity_type text not null check (entity_type in ('firearm','qualification','agency_training_event')),
  entity_id uuid,
  entity_key text,
  attachment_type text not null default 'supporting_document',
  file_name text not null check (length(btrim(file_name)) between 1 and 500),
  storage_path text not null check (length(btrim(storage_path)) between 1 and 1500),
  mime_type text not null check (length(btrim(mime_type)) between 1 and 255),
  file_size bigint not null check (file_size > 0 and file_size <= 26214400),
  description text,
  uploaded_by_user_id uuid not null references public.profiles(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by_user_id uuid references public.profiles(id) on delete restrict,
  archive_reason text,
  check ((entity_id is not null) <> (entity_key is not null)),
  unique (department_id, storage_path)
);

create table if not exists public.firearm_status_history (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  firearm_id uuid not null references public.firearms(id) on delete cascade,
  old_status text,
  new_status text not null,
  notes text,
  changed_by_user_id uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create table if not exists public.pilot_ammunition_workspaces (
  department_id uuid primary key references public.departments(id) on delete cascade,
  workspace jsonb not null default '{"dutyLots":[],"trainingLots":[],"transactions":[]}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.pilot_remediation_workspaces (
  department_id uuid primary key references public.departments(id) on delete cascade,
  remediations jsonb not null default '[]'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Tenant keys are repeated on child rows so their RLS checks are cheap. Bind
-- those repeated keys to the parent as a pair so a client cannot associate a
-- row from one department with a parent owned by another department.
do $constraints$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.ammunition_lots'::regclass and conname='ammunition_lots_id_department_key') then
    alter table public.ammunition_lots add constraint ammunition_lots_id_department_key unique(id,department_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.ammunition_reconciliations'::regclass and conname='ammunition_reconciliations_id_department_key') then
    alter table public.ammunition_reconciliations add constraint ammunition_reconciliations_id_department_key unique(id,department_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.firearms'::regclass and conname='firearms_id_department_key') then
    alter table public.firearms add constraint firearms_id_department_key unique(id,department_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.ammunition_transactions'::regclass and conname='ammunition_transactions_lot_department_fkey') then
    alter table public.ammunition_transactions add constraint ammunition_transactions_lot_department_fkey foreign key(lot_id,department_id) references public.ammunition_lots(id,department_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.ammunition_reconciliation_items'::regclass and conname='ammunition_reconciliation_items_lot_department_fkey') then
    alter table public.ammunition_reconciliation_items add constraint ammunition_reconciliation_items_lot_department_fkey foreign key(lot_id,department_id) references public.ammunition_lots(id,department_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.ammunition_reconciliation_items'::regclass and conname='ammunition_reconciliation_items_reconciliation_department_fkey') then
    alter table public.ammunition_reconciliation_items add constraint ammunition_reconciliation_items_reconciliation_department_fkey foreign key(reconciliation_id,department_id) references public.ammunition_reconciliations(id,department_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.firearm_status_history'::regclass and conname='firearm_status_history_firearm_department_fkey') then
    alter table public.firearm_status_history add constraint firearm_status_history_firearm_department_fkey foreign key(firearm_id,department_id) references public.firearms(id,department_id) on delete cascade;
  end if;
end
$constraints$;

create index if not exists ammunition_lots_department_active_idx on public.ammunition_lots(department_id,is_active,category,caliber);
create index if not exists ammunition_transactions_department_created_idx on public.ammunition_transactions(department_id,created_at desc);
create index if not exists ammunition_transactions_lot_idx on public.ammunition_transactions(lot_id,created_at desc);
create index if not exists ammunition_reconciliations_department_cycle_idx on public.ammunition_reconciliations(department_id,cycle_year desc,cycle_name);
create index if not exists ammunition_reconciliation_items_reconciliation_idx on public.ammunition_reconciliation_items(reconciliation_id);
create index if not exists attachments_department_entity_idx on public.attachments(department_id,entity_type,entity_id,entity_key) where archived_at is null;
create index if not exists firearm_status_history_firearm_idx on public.firearm_status_history(department_id,firearm_id,changed_at desc);
create index if not exists pilot_ammunition_workspaces_updated_at_idx on public.pilot_ammunition_workspaces(updated_at desc);
create index if not exists pilot_remediation_workspaces_updated_at_idx on public.pilot_remediation_workspaces(updated_at desc);

do $policies$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array['ammunition_lots','ammunition_transactions','ammunition_reconciliations','ammunition_reconciliation_items','attachments','firearm_status_history','pilot_ammunition_workspaces','pilot_remediation_workspaces']
  loop
    execute format('alter table public.%I enable row level security',table_name);
    for policy_name in select policyname from pg_policies where schemaname='public' and tablename=table_name
    loop
      execute format('drop policy if exists %I on public.%I',policy_name,table_name);
    end loop;
  end loop;
end
$policies$;

create policy ammunition_lots_select on public.ammunition_lots for select to authenticated
using (public.has_department_permission(department_id,'manage_firearms'));
create policy ammunition_lots_insert on public.ammunition_lots for insert to authenticated
with check (created_by=auth.uid() and updated_by=auth.uid() and public.has_department_permission(department_id,'manage_firearms'));
create policy ammunition_lots_update on public.ammunition_lots for update to authenticated
using (public.has_department_permission(department_id,'manage_firearms'))
with check (updated_by=auth.uid() and public.has_department_permission(department_id,'manage_firearms'));

create policy ammunition_transactions_select on public.ammunition_transactions for select to authenticated
using (public.has_department_permission(department_id,'manage_firearms'));
create policy ammunition_transactions_insert on public.ammunition_transactions for insert to authenticated
with check (actor_user_id=auth.uid() and public.has_department_permission(department_id,'manage_firearms'));

create policy ammunition_reconciliations_select on public.ammunition_reconciliations for select to authenticated
using (public.has_department_permission(department_id,'manage_firearms'));
create policy ammunition_reconciliations_insert on public.ammunition_reconciliations for insert to authenticated
with check (created_by=auth.uid() and public.has_department_permission(department_id,'manage_firearms'));
create policy ammunition_reconciliations_update on public.ammunition_reconciliations for update to authenticated
using (public.has_department_permission(department_id,'manage_firearms'))
with check (public.has_department_permission(department_id,'manage_firearms') and (submitted_by is null or submitted_by=auth.uid()) and (certified_by is null or certified_by=auth.uid()));

create policy ammunition_reconciliation_items_select on public.ammunition_reconciliation_items for select to authenticated
using (public.has_department_permission(department_id,'manage_firearms'));
create policy ammunition_reconciliation_items_insert on public.ammunition_reconciliation_items for insert to authenticated
with check (public.has_department_permission(department_id,'manage_firearms'));
create policy ammunition_reconciliation_items_delete on public.ammunition_reconciliation_items for delete to authenticated
using (public.has_department_permission(department_id,'manage_firearms'));

create policy attachments_select on public.attachments for select to authenticated
using (public.is_department_member(department_id));
create policy attachments_insert on public.attachments for insert to authenticated
with check (uploaded_by_user_id=auth.uid() and public.has_any_department_permission(department_id,array['manage_firearms','manage_inspections','manage_qualifications','manage_training','manage_range_days']));
create policy attachments_update on public.attachments for update to authenticated
using (public.has_any_department_permission(department_id,array['manage_firearms','manage_inspections','manage_qualifications','manage_training','manage_range_days']))
with check (archived_by_user_id is null or archived_by_user_id=auth.uid());

create policy firearm_status_history_select_scoped on public.firearm_status_history for select to authenticated
using (public.has_any_department_permission(department_id,array['manage_firearms','manage_inspections','view_command_dashboard','administer_department']) or exists(select 1 from public.firearm_assignments assignment where assignment.department_id=firearm_status_history.department_id and assignment.firearm_id=firearm_status_history.firearm_id and assignment.assigned_to_user_id=auth.uid()));
create policy firearm_status_history_insert_managers on public.firearm_status_history for insert to authenticated
with check (changed_by_user_id=auth.uid() and public.has_any_department_permission(department_id,array['manage_firearms','manage_inspections','administer_department']));

create policy pilot_ammunition_workspaces_select on public.pilot_ammunition_workspaces for select to authenticated
using (public.has_any_department_permission(department_id,array['manage_firearms','administer_department']));
create policy pilot_ammunition_workspaces_insert on public.pilot_ammunition_workspaces for insert to authenticated
with check (updated_by=auth.uid() and public.has_any_department_permission(department_id,array['manage_firearms','administer_department']));
create policy pilot_ammunition_workspaces_update on public.pilot_ammunition_workspaces for update to authenticated
using (public.has_any_department_permission(department_id,array['manage_firearms','administer_department']))
with check (updated_by=auth.uid() and public.has_any_department_permission(department_id,array['manage_firearms','administer_department']));

create policy pilot_remediation_workspaces_select on public.pilot_remediation_workspaces for select to authenticated
using (public.has_any_department_permission(department_id,array['manage_training','administer_department']));
create policy pilot_remediation_workspaces_insert on public.pilot_remediation_workspaces for insert to authenticated
with check (updated_by=auth.uid() and public.has_any_department_permission(department_id,array['manage_training','administer_department']));
create policy pilot_remediation_workspaces_update on public.pilot_remediation_workspaces for update to authenticated
using (public.has_any_department_permission(department_id,array['manage_training','administer_department']))
with check (updated_by=auth.uid() and public.has_any_department_permission(department_id,array['manage_training','administer_department']));

do $audit_triggers$
declare
  table_name text;
  trigger_name text;
begin
  foreach table_name in array array['ammunition_lots','ammunition_transactions','ammunition_reconciliations','ammunition_reconciliation_items','firearm_status_history']
  loop
    trigger_name := table_name||'_accountability_audit';
    execute format('drop trigger if exists %I on public.%I',trigger_name,table_name);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.write_audit_event()',trigger_name,table_name);
  end loop;
end
$audit_triggers$;

-- Notification rows are normally owner-only. These two narrow RPCs preserve
-- that rule while allowing the off-duty workflow to notify a reviewer or the
-- submitting officer without restoring a provider-wide service credential.
create or replace function public.upsert_off_duty_notification(
  p_department_id uuid,
  p_request_id uuid,
  p_target_user_id uuid,
  p_kind text,
  p_title text,
  p_detail text,
  p_priority text,
  p_fingerprint text
)
returns void
language plpgsql
security definer
set search_path = public,auth
as $$
declare
  officer_user_id uuid;
  v_notification_key text;
begin
  select request.officer_user_id into officer_user_id
  from public.off_duty_firearm_requests request
  where request.id=p_request_id and request.department_id=p_department_id;
  if officer_user_id is null then
    raise exception 'off-duty firearm request was not found' using errcode='P0002';
  end if;

  if p_kind='off_duty_firearm_review_required' then
    if auth.uid() is distinct from officer_user_id
       or not public.has_department_permission(p_department_id,'submit_off_duty_requests')
       or not exists (
         select 1
         from public.department_memberships membership
         join public.department_membership_roles membership_role
           on membership_role.department_id=membership.department_id
          and membership_role.user_id=membership.user_id
         where membership.department_id=p_department_id
           and membership.user_id=p_target_user_id
           and membership.is_active=true
           and (
             membership_role.role_code='administrator'
             or exists (
               select 1 from public.department_role_permissions role_permission
               where role_permission.department_id=p_department_id
                 and role_permission.role_code=membership_role.role_code
                 and role_permission.permission_code='review_off_duty_requests'
             )
           )
       ) then
      raise exception 'off-duty review notification forbidden' using errcode='42501';
    end if;
    v_notification_key := 'off-duty-review-'||p_request_id::text;
  elsif p_kind in ('off_duty_firearm_approved','off_duty_firearm_denied','off_duty_firearm_returned') then
    if p_target_user_id is distinct from officer_user_id
       or not public.has_department_permission(p_department_id,'review_off_duty_requests') then
      raise exception 'off-duty decision notification forbidden' using errcode='42501';
    end if;
    v_notification_key := 'off-duty-decision-'||p_request_id::text;
  else
    raise exception 'unsupported off-duty notification kind' using errcode='22023';
  end if;

  insert into public.notification_events(
    department_id,user_id,notification_key,source,kind,title,detail,href,priority,
    fingerprint,source_created_at,first_seen_at,last_seen_at,resolved_at,updated_at
  ) values (
    p_department_id,p_target_user_id,v_notification_key,'Off-Duty',p_kind,p_title,
    p_detail,'/off-duty-firearms',p_priority,p_fingerprint,now(),now(),now(),null,now()
  )
  on conflict(department_id,user_id,notification_key) do update set
    kind=excluded.kind,title=excluded.title,detail=excluded.detail,
    priority=excluded.priority,fingerprint=excluded.fingerprint,
    source_created_at=excluded.source_created_at,last_seen_at=excluded.last_seen_at,
    resolved_at=null,updated_at=excluded.updated_at;
end;
$$;

create or replace function public.resolve_off_duty_review_notifications(
  p_department_id uuid,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = public,auth
as $$
begin
  if not public.has_department_permission(p_department_id,'review_off_duty_requests')
     or not exists (
       select 1 from public.off_duty_firearm_requests request
       where request.id=p_request_id and request.department_id=p_department_id
     ) then
    raise exception 'off-duty review notification resolution forbidden' using errcode='42501';
  end if;
  update public.notification_events
  set resolved_at=now(),updated_at=now()
  where department_id=p_department_id
    and notification_key='off-duty-review-'||p_request_id::text
    and resolved_at is null;
end;
$$;

revoke all on function public.upsert_off_duty_notification(uuid,uuid,uuid,text,text,text,text,text) from public,anon,service_role;
revoke all on function public.resolve_off_duty_review_notifications(uuid,uuid) from public,anon,service_role;
grant execute on function public.upsert_off_duty_notification(uuid,uuid,uuid,text,text,text,text,text) to authenticated;
grant execute on function public.resolve_off_duty_review_notifications(uuid,uuid) to authenticated;

revoke all on public.ammunition_lots,public.ammunition_transactions,public.ammunition_reconciliations,public.ammunition_reconciliation_items,public.attachments,public.firearm_status_history,public.pilot_ammunition_workspaces,public.pilot_remediation_workspaces from anon;
grant select,insert,update,delete on public.ammunition_lots,public.ammunition_transactions,public.ammunition_reconciliations,public.ammunition_reconciliation_items,public.attachments,public.firearm_status_history,public.pilot_ammunition_workspaces,public.pilot_remediation_workspaces to authenticated,service_role;

commit;
