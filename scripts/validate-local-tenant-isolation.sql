-- Runs only inside validate-clean-bootstrap's disposable local PostgreSQL.
begin;
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000001','local-rls@example.invalid');
insert into public.profiles(id,full_name) values ('00000000-0000-4000-8000-000000000001','Disposable RLS subject') on conflict(id) do nothing;
insert into public.departments(id,name,slug) values
 ('00000000-0000-4000-8000-000000000011','RLS tenant A','local-rls-a'),
 ('00000000-0000-4000-8000-000000000012','RLS tenant B','local-rls-b');
insert into public.department_memberships(department_id,user_id) values ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001');
insert into public.equipment_types(department_id,name) values
 ('00000000-0000-4000-8000-000000000011','RLS type A'),
 ('00000000-0000-4000-8000-000000000012','RLS type B');
insert into public.department_features(department_id,feature_code,is_enabled) values
 ('00000000-0000-4000-8000-000000000011','equipment_readiness',true),
 ('00000000-0000-4000-8000-000000000012','equipment_readiness',true);
insert into public.pilot_range_workspaces(department_id) values
 ('00000000-0000-4000-8000-000000000011'),('00000000-0000-4000-8000-000000000012');
-- Exercise the grants supplied by migrations, without test-only grants.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$
begin
 if (select count(*) from public.pilot_range_workspaces) <> 1 then raise exception 'Range workspace tenant isolation failed'; end if;
 begin
  update public.pilot_range_workspaces set workspace='{}'::jsonb;
  raise exception 'Direct member workspace mutation accepted';
 exception when insufficient_privilege then null;
 end;
 if (select count(*) from public.department_features) <> 1 then raise exception 'Entitlement tenant isolation failed'; end if;
 begin
  update public.department_features set is_enabled=false where department_id='00000000-0000-4000-8000-000000000011';
  raise exception 'Member entitlement change accepted';
 exception when insufficient_privilege then null;
 end;
 if (select count(*) from public.equipment_types) <> 1 then raise exception 'Tenant read isolation failed'; end if;
 if exists(select 1 from public.equipment_types where name='RLS type B') then raise exception 'Foreign tenant leaked'; end if;
 begin
  insert into public.equipment_types(department_id,name) values ('00000000-0000-4000-8000-000000000012','Forbidden foreign write');
  raise exception 'Cross-tenant write was accepted';
 exception when insufficient_privilege then null;
 end;
 begin
  insert into public.equipment_types(department_id,name) values ('00000000-0000-4000-8000-000000000011','Forbidden non-manager write');
  raise exception 'Non-manager write was accepted';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;
