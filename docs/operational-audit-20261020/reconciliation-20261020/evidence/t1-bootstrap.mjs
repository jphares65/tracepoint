// ARM-02 isolated reproduction: apply tracked supabase/migrations (read-only from worktree) to an empty local DB.
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const CUR = "/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/current";
const { supabasePrerequisites } = await import(path.join(CUR, "scripts/postgres-bootstrap-prerequisites.mjs"));
const db = process.argv[2] ?? "arm02";
const admin = new pg.Client({ host: "127.0.0.1", port: 55491, user: "postgres", database: "postgres" });
await admin.connect(); await admin.query(`drop database if exists ${db}`); await admin.query(`create database ${db}`); await admin.end();
const c = new pg.Client({ host: "127.0.0.1", port: 55491, user: "postgres", database: db });
await c.connect();
await c.query(supabasePrerequisites.replace(/create role (\w+) nologin;/g, (m, r) => `do $$ begin if not exists (select 1 from pg_roles where rolname = '${r}') then create role ${r} nologin; end if; end $$;`));
const dir = path.join(CUR, "supabase/migrations");
const files = (await readdir(dir)).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
console.log("migrations:", files.length, "(validate-clean-bootstrap.mjs expects 75)");
let ok = 0;
for (const f of files) {
  try { const sql = (await readFile(path.join(dir, f), "utf8")).replace(/^\uFEFF/, "").replace(/create extension if not exists pgcrypto;/gi, "-- pgcrypto unavailable in embedded build; gen_random_uuid is core in PG13+"); await c.query(sql); ok++; }
  catch (e) { console.log(`FAIL at #${ok + 1} ${f}: ${e.code} ${e.message}`); break; }
}
console.log("applied:", ok);
const t = await c.query(`select n, to_regclass('public.'||n) is not null as present from unnest(array['firearms','firearm_assignments','firearm_status_history','ammunition_lots','ammunition_transactions','ammunition_reconciliations','ammunition_reconciliation_items','attachments','pilot_ammunition_workspaces']) n`);
console.table(t.rows);
const f = await c.query(`select p.oid::regprocedure as fn, has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec, has_function_privilege('anon', p.oid, 'execute') as anon_exec, p.prosecdef as security_definer, p.proacl::text as acl from pg_proc p where p.proname='update_firearm_with_audit'`);
console.table(f.rows);
await c.end();
