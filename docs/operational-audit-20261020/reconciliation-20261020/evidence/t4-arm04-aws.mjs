// ARM-04 on the AWS-native chain (db arm04aws from t3): grants + behavioural check of the 017 bound wrapper.
import pg from "pg";
const c = new pg.Client({ host: "127.0.0.1", port: 55491, user: "postgres", database: "arm04aws" });
await c.connect();
const q = (s, v) => c.query(s, v);
const priv = await q(`select p.oid::regprocedure::text fn, p.prosecdef secdef,
  has_function_privilege('anon', p.oid, 'execute') anon,
  has_function_privilege('authenticated', p.oid, 'execute') authenticated,
  has_function_privilege('service_role', p.oid, 'execute') service_role,
  has_function_privilege('tracepoint_runtime', p.oid, 'execute') tracepoint_runtime,
  coalesce(p.proacl::text,'(default: PUBLIC)') acl
  from pg_proc p where p.proname in ('update_firearm_with_audit','update_firearm_with_audit_internal') order by 1`);
console.table(priv.rows);
const runtime = await q(`select rolname, rolcanlogin, rolinherit, rolbypassrls, pg_has_role('tracepoint_runtime','authenticated','member') member_of_authenticated from pg_roles where rolname='tracepoint_runtime'`);
console.table(runtime.rows);
const A = "aaaaaaaa-0000-4000-8000-000000000001", Bd = "bbbbbbbb-0000-4000-8000-000000000002";
const attacker = "cccccccc-0000-4000-8000-000000000003", armorerA = "dddddddd-0000-4000-8000-000000000004", firearm = "eeeeeeee-0000-4000-8000-000000000005";
await q("begin");
await q("insert into auth.users(id,email) values($1,'attacker@b.test'),($2,'armorer@a.test') on conflict do nothing", [attacker, armorerA]);
await q("insert into public.profiles(id,email,full_name) values($1,'attacker@b.test','Attacker'),($2,'armorer@a.test','Armorer A') on conflict (id) do nothing", [attacker, armorerA]);
await q("insert into public.departments(id,name,slug) values($1,'Agency A','agency-a'),($2,'Agency B','agency-b') on conflict do nothing", [A, Bd]);
await q("insert into public.department_memberships(department_id,user_id) values($1,$2),($3,$4) on conflict do nothing", [Bd, attacker, A, armorerA]);
await q("insert into public.department_membership_roles(department_id,user_id,role_code) values($1,$2,'administrator'),($3,$4,'administrator') on conflict do nothing", [Bd, attacker, A, armorerA]);
await q("insert into public.firearms(id,department_id,serial_number,make,model,caliber,firearm_type) values($1,$2,'SN-ORIGINAL','Glock','17','9mm','handgun') on conflict do nothing", [firearm, A]);
await q("commit");
let n = 0;
const call = async (label, sub, dept, pDept, pUser, serial) => {
  try {
    await q("begin"); await q("set local role authenticated");
    await q("select set_config('tracepoint.subject_id',$1,true), set_config('tracepoint.department_id',$2,true)", [sub, dept]);
    const r = await q("select public.update_firearm_with_audit($1,$2,$3,'note','Glock','17',$4,'handgun','9mm',null,null) out", [firearm, pDept, pUser, serial]);
    await q("commit"); console.log(label, "=> OK", JSON.stringify(r.rows[0].out));
  } catch (e) { await q("rollback"); console.log(label, "=> ERROR", e.code, e.message); }
};
await call("1 attacker(B) ctx=B, p_department=A", attacker, Bd, A, attacker, "SN-X1");
await call("2 attacker(B) spoofs ctx dept=A (needs raw SQL)", attacker, A, A, attacker, "SN-X2");
await call("3 armorer(A) forges p_user_id=attacker", armorerA, A, A, attacker, "SN-X3");
await call("4 armorer(A) legitimate", armorerA, A, A, armorerA, "SN-LEGIT");
try { await q("begin"); await q("set local role authenticated"); await q("select public.update_firearm_with_audit_internal($1,$2,$3,'n','Glock','17','SN-X5','handgun','9mm',null,null)", [firearm, A, attacker]); await q("rollback"); console.log("5 internal direct => OK (BAD)"); } catch (e) { await q("rollback"); console.log("5 internal direct as authenticated => ERROR", e.code, e.message); }
try { await q("begin"); await q("set local role anon"); await q("select public.update_firearm_with_audit($1,$2,$3,'n','Glock','17','SN-X6','handgun','9mm',null,null)", [firearm, A, attacker]); await q("rollback"); console.log("6 anon => OK (BAD)"); } catch (e) { await q("rollback"); console.log("6 anon => ERROR", e.code, e.message); }
console.log("final:", (await q("select serial_number from public.firearms where id=$1", [firearm])).rows[0]);
await c.end();
