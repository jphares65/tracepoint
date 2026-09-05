import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const project='wztqqqashilusoppddxi';
const identifier=value=>'"'+String(value).replaceAll('"','""')+'"';
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const fingerprint=query=>`(select encode(sha256(convert_to(coalesce(string_agg(to_jsonb(meta)::text,E'\\n' order by to_jsonb(meta)::text),''),'UTF8')),'hex') from (${query}) meta)`;
export const catalogSql=`select
 (select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r') as tables,
 (select coalesce(jsonb_agg(c.relname order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S') as sequences,
 (select coalesce(jsonb_agg(jsonb_build_object('name',c.conname,'table',t.relname,'referenceSchema',rn.nspname,'referenceTable',rt.relname,
 'columns',(select jsonb_agg(a.attname order by k.ord) from unnest(c.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=t.oid and a.attnum=k.num),
 'referenceColumns',(select jsonb_agg(a.attname order by k.ord) from unnest(c.confkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=rt.oid and a.attnum=k.num)) order by t.relname,c.conname),'[]')
 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
 join pg_class rt on rt.oid=c.confrelid join pg_namespace rn on rn.oid=rt.relnamespace where n.nspname='public' and c.contype='f') as foreign_keys;`;

export function manifestSql(catalog, versions) {
 if(!Array.isArray(catalog.tables)||!catalog.tables.length||catalog.tables.length>500||!Array.isArray(catalog.foreign_keys)||!Array.isArray(catalog.sequences))throw Error('Invalid bounded catalog');
 const tables=catalog.tables.map(name=>`select ${literal(name)} as name,count(*) as count,
 encode(sha256(convert_to(coalesce(string_agg(row_hash,E'\\n' order by row_hash),''),'UTF8')),'hex') as sha256
 from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') as row_hash from public.${identifier(name)} t) rows`);
 const relationships=catalog.foreign_keys.map(fk=>{
  if(!['public','auth','storage'].includes(fk.referenceSchema)||!fk.columns?.length||fk.columns.length!==fk.referenceColumns?.length)throw Error('Unsupported relationship');
  const notNull=fk.columns.map(c=>`t.${identifier(c)} is not null`).join(' and ');
  const matches=fk.columns.map((c,i)=>`t.${identifier(c)}=r.${identifier(fk.referenceColumns[i])}`).join(' and ');
  return `select ${literal(fk.table)} as table_name,${literal(fk.name)} as name,count(*) as orphan_count from public.${identifier(fk.table)} t where ${notNull} and not exists(select 1 from ${identifier(fk.referenceSchema)}.${identifier(fk.referenceTable)} r where ${matches})`;
 });
 const sequenceQueries=catalog.sequences.map(name=>`select ${literal(name)} as name,last_value,is_called from public.${identifier(name)}`);
 const metadata={
  columns:`select table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_schema,udt_name from information_schema.columns where table_schema='public'`,
  // Pretty deparse removes redundant Boolean parentheses that pg_dump/reparse normalizes.
  // Names, types, validation state and the complete expression remain fingerprinted.
  constraints:`select t.relname,c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid,true) as definition from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public'`,
  policies:`select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public'`,
  functions:`select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')`,
  triggers:`select c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal`,
  grants:`select grantee,table_name,privilege_type,is_grantable from information_schema.table_privileges where table_schema='public'`,
  indexes:`select tablename,indexname,indexdef from pg_indexes where schemaname='public'`,
  rls:`select c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`,
  sequenceDefinitions:`select sequencename,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size from pg_sequences where schemaname='public'`,
 };
 const aggregate=queries=>queries.length?`(select jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text) from (${queries.join('\nunion all\n')}) x)`:`'[]'::jsonb`;
 return `begin isolation level repeatable read read only;
 set local statement_timeout='60s';
 do $$ begin
 if (select array_agg(version order by version) from supabase_migrations.schema_migrations) is distinct from array[${versions.map(literal).join(',')}]::text[] then raise exception 'Unexpected migration ledger'; end if;
 if (select array_agg(c.relname::text order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r') is distinct from array[${[...catalog.tables].sort().map(literal).join(',')}]::text[] then raise exception 'Catalog changed'; end if;
 end $$;
 select jsonb_build_object('format',2,'algorithm','postgres-jsonb-text-sha256-v1','migrationCount',${versions.length},
 'tables',${aggregate(tables)},'relationships',${aggregate(relationships)},'sequences',${aggregate(sequenceQueries)},
 'metadata',jsonb_build_object(${Object.entries(metadata).map(([key,query])=>literal(key)+','+fingerprint(query)).join(',')})) as manifest;
 commit;`;
}

async function main() {
 if(!process.argv.includes('--management-cli'))throw Error('Explicit --management-cli is required. Only isolated staging is supported.');
 let directory;
 try {
  const env={...process.env,AWS_REGION:'us-east-1',AWS_DEFAULT_REGION:'us-east-1',AWS_CLI_OUTPUT_ENCODING:'UTF-8'};
  const identity=JSON.parse(execFileSync('aws.exe',['sts','get-caller-identity','--region','us-east-1','--output','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  assert.equal(identity.Account,'559054714699');assert.match(identity.Arn,/^arn:aws:sts::559054714699:assumed-role\/[^/]*TracePointMigrationStaging[^/]*\//);
  directory=mkdtempSync(path.join(tmpdir(),'tracepoint-readonly-manifest-'));
  function query(sql,name) {
   const file=path.join(directory,name+'.sql');writeFileSync(file,sql);
   const command=`& npx.cmd supabase db query --linked --project-ref ${project} --file '${file.replaceAll("'","''")}' --output json; exit $LASTEXITCODE`;
   const output=process.platform==='win32'?execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024}):
    execFileSync('npx',['supabase','db','query','--linked','--project-ref',project,'--file',file,'--output','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024});
   return JSON.parse(output).rows;
  }
  const catalog=query(catalogSql,'catalog')[0];
  const versions=readdirSync('supabase/migrations').filter(x=>/^\d+_.+\.sql$/.test(x)).map(x=>x.split('_')[0]).sort();
  const manifest=query(manifestSql(catalog,versions),'manifest')[0].manifest;
  assert.ok(manifest.relationships.every(x=>Number(x.orphan_count)===0));
  const compare=process.argv.indexOf('--compare');
  if(compare>=0){const previous=JSON.parse(readFileSync(process.argv[compare+1],'utf8').replace(/^\uFEFF/,''));assert.deepEqual(manifest,previous);console.log(JSON.stringify({equal:true,tables:manifest.tables.length,relationships:manifest.relationships.length,migrations:manifest.migrationCount}));}
  else console.log(JSON.stringify(manifest,null,2));
 } catch {console.error('Staging management manifest failed; query contents, credentials and row data suppressed.');process.exitCode=1;}
 finally {if(directory){const resolved=path.resolve(directory);if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('tracepoint-readonly-manifest-'))throw Error('Cleanup boundary failed');rmSync(resolved,{recursive:true,force:true});}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
