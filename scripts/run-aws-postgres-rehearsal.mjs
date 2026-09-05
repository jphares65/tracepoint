import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {supabasePrerequisites} from './postgres-bootstrap-prerequisites.mjs';
import {catalogSql,manifestSql} from './staging-management-manifest.mjs';
let phase='target validation';

// This runner accepts only a new disposable database in the isolated AWS account.
// ECS injects the RDS-managed secret; neither credentials nor SQL rows are logged.
export function validateTarget(env){
 assert.equal(env.REHEARSAL_ACCOUNT,'559054714699');assert.equal(env.AWS_REGION,'us-east-1');
 assert.match(env.REHEARSAL_RUN,/^[0-9a-f]{12}$/);
 assert.match(env.PGHOST,new RegExp('^tp-rehearsal-'+env.REHEARSAL_RUN+'\\.[a-z0-9]+\\.us-east-1\\.rds\\.amazonaws\\.com$'));
 assert.equal(env.PGDATABASE,'tracepoint_rehearsal');
 assert.equal(env.REHEARSAL_PURPOSE,'disposable-synthetic-only');
}
async function main(){
 validateTarget(process.env);
 phase='managed credential validation';
 const secret=JSON.parse(process.env.RDS_MANAGED_SECRET);delete process.env.RDS_MANAGED_SECRET;
 assert.equal(secret.username,'tprehearsal');assert.ok(secret.password);
 const ca=await readFile('/app/rds-ca.pem','utf8');
 const config={host:process.env.PGHOST,port:5432,user:secret.username,password:secret.password,database:'tracepoint_rehearsal',ssl:{ca,rejectUnauthorized:true},connectionTimeoutMillis:15000};
 const client=new pg.Client(config);let restored;const directory=await mkdtemp(path.join(tmpdir(),'tp-rds-'));
 try{
  phase='verified TLS connection';
  await client.connect();
  phase='empty database gate';
  const {rows:[fresh]}=await client.query("select (select count(*) from pg_tables where schemaname='public')::int as tables, exists(select 1 from pg_database where datname='tracepoint_restore') as restore_exists");
  assert.equal(fresh.tables,0);assert.equal(fresh.restore_exists,false);
  await client.query("set statement_timeout='60s'");
  phase='compatibility bootstrap';
  await client.query(supabasePrerequisites);
  // RDS master is not a PostgreSQL superuser: explicitly authorize SET ROLE used
  // by the synthetic RLS suite, without granting any production identity access.
  await client.query('grant anon, authenticated, service_role to tprehearsal');
  phase='migration source gate';const files=(await readdir('supabase/migrations')).filter(f=>/^\d+_.+\.sql$/.test(f)).sort();assert.equal(files.length,65);
  await client.query('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)');
  for(const file of files){
   phase='ordered migrations';
   try{await client.query('begin');await client.query((await readFile('supabase/migrations/'+file,'utf8')).replace(/^\uFEFF/,''));await client.query('insert into supabase_migrations.schema_migrations values($1)',[file.split('_')[0]]);await client.query('commit');}
   catch(error){await client.query('rollback');console.log(JSON.stringify({failedMigration:file,sqlState:error.code}));throw Error('Disposable migration failed');}
  }
  phase='source tenant isolation';for(const file of ['validate-local-tenant-isolation.sql','validate-local-armory-workflows.sql'])await client.query(await readFile('scripts/'+file,'utf8'));
  const catalog=(await client.query(catalogSql)).rows[0];
  const snapshot=async connection=>{const result=await connection.query(manifestSql(catalog,files.map(f=>f.split('_')[0])));const found=result.find(r=>r.rows?.[0]?.manifest)?.rows[0].manifest;assert.ok(found);assert.ok(found.relationships.every(r=>Number(r.orphan_count)===0));return found;};
  phase='source manifest';const before=await snapshot(client);const dump=path.join(directory,'synthetic.dump');
  const env={...process.env,PGUSER:secret.username,PGPASSWORD:secret.password,PGSSLMODE:'verify-full',PGSSLROOTCERT:'/app/rds-ca.pem'};
  phase='synthetic export';const run=promisify(execFile);await run('pg_dump',['-Fc','--no-owner','-f',dump,'tracepoint_rehearsal'],{env,timeout:120000});
  await client.query('create database tracepoint_restore');const started=Date.now();
  phase='synthetic restore';await run('pg_restore',['--no-owner','--exit-on-error','-d','tracepoint_restore',dump],{env,timeout:120000});
  restored=new pg.Client({...config,database:'tracepoint_restore'});await restored.connect();
  phase='restore reconciliation';const after=await snapshot(restored);if(JSON.stringify(after)!==JSON.stringify(before))console.log(JSON.stringify({reconciliationDifferences:Object.keys(before).filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key])),metadataDifferences:Object.keys(before.metadata).filter(key=>before.metadata[key]!==after.metadata[key])}));assert.deepEqual(after,before);
  phase='restored tenant isolation';for(const file of ['validate-local-tenant-isolation.sql','validate-local-armory-workflows.sql'])await restored.query(await readFile('scripts/'+file,'utf8'));
  console.log(JSON.stringify({rehearsal:'PASSED',run:process.env.REHEARSAL_RUN,migrations:files.length,tables:before.tables.length,relationships:before.relationships.length,restoreMilliseconds:Date.now()-started,tlsVerified:true,tenantNegativeTests:true,metadataReconciled:Object.keys(before.metadata),dataSource:'synthetic migration fixtures only'}));
 }finally{await restored?.end().catch(()=>{});await client.end().catch(()=>{});await rm(directory,{recursive:true,force:true});}
}
if(process.argv[1]?.endsWith('run-aws-postgres-rehearsal.mjs'))main().catch(error=>{console.error(JSON.stringify({rehearsal:'FAILED',phase,errorName:error.name,sqlState:error.code}));process.exitCode=1;});
