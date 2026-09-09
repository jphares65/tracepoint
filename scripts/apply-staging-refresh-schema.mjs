import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {reviewedRefreshSchema} from './refresh-schema-source.mjs';
const project='wztqqqashilusoppddxi',file='202609050011_authentication_refresh_state.sql',version=file.split('_')[0];
const literal=value=>"'"+value.replaceAll("'","''")+"'";
let directory;const temporary=[];
function gate(){const id=JSON.parse(execFileSync('aws.exe',['sts','get-caller-identity','--region','us-east-1','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.equal(id.Account,'559054714699');assert.match(id.Arn,/^arn:aws:sts::559054714699:assumed-role\/[^/]*TracePointMigrationStaging[^/]*\//);assert.equal(process.env.AWS_REGION??process.env.AWS_DEFAULT_REGION,'us-east-1');}
function query(sql){const target=path.join(directory,'query-'+temporary.length+'.sql');writeFileSync(target,sql);temporary.push(target);const command="& npx.cmd supabase db query --linked --project-ref "+project+" --file '"+target.replaceAll("'","''")+"' --output json; exit $LASTEXITCODE";return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024})).rows;}
try{
 assert.ok(process.argv.includes('--execute'),'Explicit staging-only execution required');gate();
 const files=readdirSync('supabase/migrations').filter(x=>/^\d+_.+\.sql$/.test(x)).sort();assert.equal(files.length,67);assert.equal(files.at(-1),file);const versions=files.map(x=>x.split('_')[0]);
 const {source}=reviewedRefreshSchema(readFileSync('supabase/migrations/'+file,'utf8'));assert.match(source,/^begin;/);assert.match(source,/commit;\s*$/);assert.equal((source.match(/create table /g)??[]).length,1);assert.ok(source.includes('create table public.authentication_refresh_sessions'));assert.ok(!/\b(drop|truncate|delete|update|insert)\b/i.test(source.replace(/grant[^;]+;/g,'').replace(/\bon delete cascade\b/gi,'')));
 directory=mkdtempSync(path.join(tmpdir(),'tracepoint-refresh-schema-'));
 const actual=query('select version from supabase_migrations.schema_migrations order by version').map(x=>x.version);let applied=false;
 if(JSON.stringify(actual)!==JSON.stringify(versions)){
  assert.deepEqual(actual,versions.slice(0,-1));gate();const body=source.replace(/^begin;\s*/,'').replace(/commit;\s*$/,'');
  const sql="begin; set local statement_timeout='20s'; do $$ begin if (select array_agg(version order by version) from supabase_migrations.schema_migrations) is distinct from array["+actual.map(literal).join(',')+"]::text[] then raise exception 'Staging ledger changed'; end if; end $$;\n"+body+"\ninsert into supabase_migrations.schema_migrations(version,name,statements) values("+literal(version)+",'authentication_refresh_state',array["+literal(body)+"]); commit;";
  query(sql);applied=true;
 }
 assert.deepEqual(query('select version from supabase_migrations.schema_migrations order by version').map(x=>x.version),versions);
 const checks=query("select (select count(*)::int from public.authentication_refresh_sessions) as rows, (select relrowsecurity from pg_class where oid='public.authentication_refresh_sessions'::regclass) as rls, (select count(*)::int from information_schema.table_privileges where table_schema='public' and table_name='authentication_refresh_sessions' and grantee in ('anon','authenticated')) as browser_grants, (select count(*)::int from pg_policies where schemaname='public' and tablename='authentication_refresh_sessions') as browser_policies")[0];assert.deepEqual(checks,{rows:0,rls:true,browser_grants:0,browser_policies:0});
 console.log(JSON.stringify({project,migrations:67,exactLedger:true,applied,sha256:createHash('sha256').update(source).digest('hex'),checks,applicationProviderSwitched:false,checkedAtUTC:new Date().toISOString()},null,2));
}catch{console.error('Staging refresh-schema gate failed; query, credentials and values suppressed.');process.exitCode=1;}
finally{for(const target of temporary)unlinkSync(target);if(directory)rmdirSync(directory);}
