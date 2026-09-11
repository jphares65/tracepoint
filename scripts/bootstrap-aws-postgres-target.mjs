import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { supabasePrerequisites } from "./postgres-bootstrap-prerequisites.mjs";
import { normalizeTransactionalSql, parseBootstrapConfiguration } from "./bootstrap-aws-postgres-target-core.mjs";
import { AWS_MIGRATION_LEDGER, loadVerifiedAwsMigrations } from "./aws-migration-ledger.mjs";
import { normalizeMigrationSql } from "./migration-sql-core.mjs";

const configuration = parseBootstrapConfiguration(process.env);
const ca = await readFile(configuration.caPath, "utf8");
const connect = (credential) => new pg.Client({
  host: credential.host, port: credential.port, user: credential.username,
  password: credential.password, database: credential.dbname,
  ssl: {ca, rejectUnauthorized:true}, connectionTimeoutMillis:10_000,
  statement_timeout:60_000, application_name:"tracepoint-database-bootstrap",
});
const checksum = (sql) => createHash("sha256").update(sql).digest("hex");
const migrator = connect(configuration.migrator);
let locked = false;
try {
  await migrator.connect();
  await migrator.query("select pg_advisory_lock(hashtext('tracepoint:aws-schema-bootstrap'))");
  locked = true;
  await migrator.query(supabasePrerequisites);
  await migrator.query(`create schema if not exists tracepoint_migrations;
    create table if not exists tracepoint_migrations.applied_migrations(
      kind text not null check(kind in ('source','aws')), name text not null,
      sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'), applied_at timestamptz not null default clock_timestamp(),
      primary key(kind,name));`);

  const groups = [
    {kind:"source",dir:"supabase/migrations",expected:76},
  ];
  let applied = 0;
  for (const group of groups) {
    const files=(await readdir(group.dir)).filter(file=>/^\d+_.+\.sql$/.test(file)).sort();
    assert.equal(files.length,group.expected,`Expected ${group.expected} ${group.kind} migrations`);
    for (const file of files) {
      const raw=normalizeMigrationSql(await readFile(path.join(group.dir,file),"utf8"));
      const digest=checksum(raw);
      const existing=await migrator.query("select sha256 from tracepoint_migrations.applied_migrations where kind=$1 and name=$2",[group.kind,file]);
      if(existing.rowCount){assert.equal(existing.rows[0].sha256,digest,`Applied migration changed: ${file}`);continue;}
      await migrator.query("begin");
      try {
        await migrator.query(normalizeTransactionalSql(raw,file));
        await migrator.query("insert into tracepoint_migrations.applied_migrations(kind,name,sha256) values($1,$2,$3)",[group.kind,file,digest]);
        await migrator.query("commit");
        applied++;
      } catch(error) { await migrator.query("rollback"); throw error; }
    }
  }
  for (const migration of await loadVerifiedAwsMigrations()) {
    const existing=await migrator.query("select sha256 from tracepoint_migrations.applied_migrations where kind='aws' and name=$1",[migration.name]);
    if(existing.rowCount){assert.equal(existing.rows[0].sha256,migration.sha256,`Applied migration changed: ${migration.name}`);continue;}
    await migrator.query("begin");
    try {
      await migrator.query(normalizeTransactionalSql(migration.sql,migration.name));
      await migrator.query("insert into tracepoint_migrations.applied_migrations(kind,name,sha256) values('aws',$1,$2)",[migration.name,migration.sha256]);
      await migrator.query("commit");applied++;
    } catch(error) { await migrator.query("rollback"); throw error; }
  }

  const escaped=await migrator.query("select format('alter role tracepoint_runtime login password %L', $1::text) as sql",[configuration.runtime.password]);
  await migrator.query(escaped.rows[0].sql);
  const forbidden=await migrator.query(`select
    (select count(*)::int from pg_policies where schemaname='public' and (coalesce(qual,'') like '%auth.uid()%' or coalesce(with_check,'') like '%auth.uid()%')) as policies,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','tracepoint_auth') and p.prokind in ('f','p') and pg_get_functiondef(p.oid) like '%auth.uid()%') as functions`);
  assert.deepEqual(forbidden.rows[0],{policies:0,functions:0});

  const runtime=connect(configuration.runtime);
  try {
    await runtime.connect();
    await runtime.query("select count(*) from public.authentication_access_sessions");
    await assert.rejects(runtime.query("set role service_role"),(error)=>error?.code==="42501");
    await runtime.query("set role authenticated");
    await runtime.query("select count(*) from public.profiles");
  } finally { await runtime.end(); }
  console.log(JSON.stringify({status:"PASSED",sourceMigrations:76,awsMigrations:AWS_MIGRATION_LEDGER.length,newlyApplied:applied,runtimeRoleVerified:true,supabaseAuthorizationReferences:0}));
} finally {
  if(locked)await migrator.query("select pg_advisory_unlock(hashtext('tracepoint:aws-schema-bootstrap'))").catch(()=>{});
  await migrator.end().catch(()=>{});
}
