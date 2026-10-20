// ARM-04 / ARM-33 isolated reproduction on the Supabase-lineage schema produced by t1 (db arm02, 75 tracked migrations applied).
import pg from "pg";
const c = new pg.Client({ host: "127.0.0.1", port: 55491, user: "postgres", database: "arm02" });
await c.connect();
const A = "aaaaaaaa-0000-4000-8000-000000000001", Bd = "bbbbbbbb-0000-4000-8000-000000000002";
const attacker = "cccccccc-0000-4000-8000-000000000003", victimArmorer = "dddddddd-0000-4000-8000-000000000004";
const firearm = "eeeeeeee-0000-4000-8000-000000000005";
const q = (s, v) => c.query(s, v);
await q("begin");
await q("insert into auth.users(id,email) values($1,'attacker@b.test'),($2,'armorer@a.test') on conflict do nothing", [attacker, victimArmorer]);
await q("insert into public.departments(id,name,slug) values($1,'Agency A','agency-a'),($2,'Agency B','agency-b') on conflict do nothing", [A, Bd]);
await q("insert into public.firearms(id,department_id,serial_number,make,model,caliber,firearm_type) values($1,$2,'SN-ORIGINAL','Glock','17','9mm','handgun') on conflict do nothing", [firearm, A]);
await q("commit");
const run = async (label, role, sub, args) => {
  try {
    await q("begin");
    await q(`set local role ${role}`);
    if (sub) await q("select set_config('request.jwt.claim.sub',$1,true)", [sub]);
    const r = await q("select public.update_firearm_with_audit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as out", args);
    await q("commit");
    console.log(label, "=> OK", JSON.stringify(r.rows[0].out));
  } catch (e) { await q("rollback"); console.log(label, "=> ERROR", e.code, e.message); }
};
// 1) authenticated user of Agency B (no membership in A) edits Agency A's firearm and forges actor = A's armorer
await run("ARM-04 cross-tenant as authenticated", "authenticated", attacker, [firearm, A, victimArmorer, "forged note", "Glock", "17", "SN-TAMPERED", "handgun", "9mm", null, null]);
// 2) same call as anon (no JWT subject)
await run("ARM-04 as anon", "anon", null, [firearm, A, victimArmorer, "anon note", "Glock", "19", "SN-TAMPERED-2", "handgun", "9mm", null, null]);
const f = await q("select serial_number, model from public.firearms where id=$1", [firearm]);
const a = await q("select changed_by_user_id, change_note, changed_fields from public.audit_log where entity_id=$1 order by created_at", [firearm]).catch(e => ({ rows: [{ error: e.message }] }));
console.log("firearm now:", f.rows[0]); console.table(a.rows);
// 3) ARM-33: route passes "" for an empty caliber (cleanOptionalText never returns null)
await run("ARM-33 empty caliber (as postgres)", "postgres", null, [firearm, A, victimArmorer, "fix import", "Glock", "17", "SN-ORIGINAL", "handgun", "", null, null]);
await c.end();
