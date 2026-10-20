// ARM-04 AWS-native: build Supabase lineage (with a stub attachments table so the chain can proceed), then apply database/aws/*.sql in order.
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const CUR = "/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/current";
const { supabasePrerequisites } = await import(path.join(CUR, "scripts/postgres-bootstrap-prerequisites.mjs"));
const db = "arm04aws";
const admin = new pg.Client({ host: "127.0.0.1", port: 55491, user: "postgres", database: "postgres" });
await admin.connect(); await admin.query(`drop database if exists ${db}`); await admin.query(`create database ${db}`); await admin.end();
const c = new pg.Client({ host: "127.0.0.1", port: 55491, user: "postgres", database: db });
await c.connect();
await c.query(supabasePrerequisites.replace(/create role (\w+) nologin;/g, (m, r) => `do $$ begin if not exists (select 1 from pg_roles where rolname='${r}') then create role ${r} nologin; end if; end $$;`));
const clean = s => s.replace(/^﻿/, "").replace(/create extension if not exists pgcrypto;/gi, "");
const sdir = path.join(CUR, "supabase/migrations");
for (const f of (await readdir(sdir)).filter(f => /^\d+_.+\.sql$/.test(f)).sort()) {
  if (f.startsWith("202610020001")) await c.query("create table if not exists public.attachments(id uuid primary key default gen_random_uuid(), department_id uuid not null, entity_id uuid, entity_type text not null, archived_at timestamptz) -- STUB: untracked in repo");
  if (f.startsWith("202610020002") || f.startsWith("202610020003")) { console.log("skip (inventory, re-applied by database/aws 035/036):", f); continue; }
  try { await c.query(clean(await readFile(path.join(sdir, f), "utf8"))); } catch (e) { console.log("supabase FAIL", f, e.message); process.exit(1); }
}
console.log("supabase lineage applied (with attachments stub)");
const adir = path.join(CUR, "database/aws");
const done = [];
for (const f of (await readdir(adir)).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort()) {
  try { await c.query(await readFile(path.join(adir, f), "utf8")); done.push(f.slice(0,3)); }
  catch (e) { await c.query("rollback").catch(()=>{}); console.log("aws FAIL", f, e.code, e.message.slice(0,200)); }
}
console.log("aws applied:", done.join(","));
await c.end();
