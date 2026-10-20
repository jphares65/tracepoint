import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const S="/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad", CUR=S+"/current", V=S+"/verify-db";
const { supabasePrerequisites } = await import(path.join(CUR, "scripts/postgres-bootstrap-prerequisites.mjs"));
const db = "tpverify";
const admin = new pg.Client({ host: "127.0.0.1", port: 55493, user: "postgres", database: "postgres" });
await admin.connect(); await admin.query(`drop database if exists ${db}`); await admin.query(`create database ${db}`); await admin.end();
const c = new pg.Client({ host: "127.0.0.1", port: 55493, user: "postgres", database: db });
await c.connect();
await c.query(supabasePrerequisites.replace(/create role (\w+) nologin;/g, (m, r) => `do $$ begin if not exists (select 1 from pg_roles where rolname='${r}') then create role ${r} nologin; end if; end $$;`));
await c.query("create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)");
const items = [];
const sdir = path.join(CUR, "supabase/migrations");
for (const f of (await readdir(sdir)).filter(f => /^\d+_.+\.sql$/.test(f))) items.push({k:f, p:path.join(sdir,f), src:"supabase"});
items.push({k:"202609100001_complete_module_tables.sql", p:path.join(V,"202609100001_complete_module_tables.sql"), src:"other-branch"});
items.sort((a,b)=>a.k<b.k?-1:1);
const adir = path.join(CUR, "database/aws");
for (const f of (await readdir(adir)).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort()) items.push({k:f,p:path.join(adir,f),src:"aws"});
for (const it of items) {
  const sql = (await readFile(it.p,"utf8")).replace(/^﻿/,"");
  try { await c.query("begin"); await c.query(sql); await c.query("commit"); console.log("OK  ", it.src, it.k); }
  catch (e) { await c.query("rollback").catch(()=>{}); console.log("FAIL", it.src, it.k, e.code, e.message.slice(0,300)); }
}
await c.end();
