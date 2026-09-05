begin;

-- Later migrations added RLS policies without the underlying API role grants.
-- Grant only operations already represented by authenticated/PUBLIC policies
-- on RLS-enabled application tables. Never grant on unprotected tables here.
do $$
declare policy_grant record;
begin
  for policy_grant in
    select distinct c.relname as table_name,
      case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
        when 'w' then 'UPDATE' when 'd' then 'DELETE'
        when '*' then 'SELECT, INSERT, UPDATE, DELETE' end as operations
    from pg_policy p
    join pg_class c on c.oid=p.polrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relrowsecurity
      and (0::oid=any(p.polroles) or (select oid from pg_roles where rolname='authenticated')=any(p.polroles))
  loop
    execute format('grant %s on table public.%I to authenticated',policy_grant.operations,policy_grant.table_name);
  end loop;
end $$;

commit;
