begin;
-- Restore schema required by the existing application. No tenant is enabled
-- automatically, and existing rows/policies are left intact on upgraded targets.
create table if not exists public.feature_catalog (
 code text primary key, display_name text not null, description text,
 sort_order integer not null default 0, is_active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.department_features (
 department_id uuid not null references public.departments(id) on delete cascade,
 feature_code text not null references public.feature_catalog(code),
 is_enabled boolean not null default false, enabled_at timestamptz, disabled_at timestamptz,
 updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id) on delete set null,
 primary key(department_id,feature_code)
);
create table if not exists public.department_feature_events (
 id uuid primary key default gen_random_uuid(),
 department_id uuid not null references public.departments(id) on delete cascade,
 feature_code text not null references public.feature_catalog(code),
 previous_enabled boolean, new_enabled boolean not null,
 actor_user_id uuid references public.profiles(id) on delete set null,
 reason text, created_at timestamptz not null default now()
);
alter table public.feature_catalog enable row level security;
alter table public.department_features enable row level security;
alter table public.department_feature_events enable row level security;
-- API users can read their own entitlements; entitlement writes are server-only.
-- The supported server route separately requires an active platform administrator.
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='feature_catalog' and policyname='feature_catalog_authenticated_read') then
  create policy feature_catalog_authenticated_read on public.feature_catalog for select to authenticated using(true);
 end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='department_features' and policyname='feature_entitlements_member_read') then
  create policy feature_entitlements_member_read on public.department_features for select to authenticated using(public.is_department_member(department_id));
 end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='department_feature_events' and policyname='feature_events_member_read') then
  create policy feature_events_member_read on public.department_feature_events for select to authenticated using(public.is_department_member(department_id));
 end if;
end $$;
grant select on public.feature_catalog,public.department_features,public.department_feature_events to authenticated;
grant select,insert,update,delete on public.feature_catalog,public.department_features,public.department_feature_events to service_role;
insert into public.feature_catalog(code,display_name,sort_order) values
 ('ammunition','Ammunition',10),('analytics','Analytics',20),('certifications','Certifications',30),
 ('command_dashboard','Command Dashboard',40),('equipment_readiness','Equipment Readiness',50),
 ('firearms','Firearms',60),('off_duty','Off-duty Firearms',70),('qualifications','Qualifications',80),('range_training','Range and Training',90)
on conflict(code) do nothing;
do $$ declare t text; begin
 foreach t in array array['department_features','department_feature_events'] loop
  if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname=t||'_accountability_audit') then
   execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.write_audit_event()',t||'_accountability_audit',t);
  end if;
 end loop;
end $$;
alter table public.department_rules add column if not exists qualification_valid_days integer not null default 365;
alter table public.department_rules add column if not exists qualification_due_soon_days integer not null default 30;
commit;
