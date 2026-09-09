import pg from 'pg';
import { sha256, canonical } from './migration-manifest.mjs';
const connection=process.env.TRACEPOINT_STAGING_DB_URL;
if(!connection) throw new Error('TRACEPOINT_STAGING_DB_URL is required');
let url;try{url=new URL(connection);}catch{throw new Error('Invalid staging database URL; value suppressed')}
const project='wztqqqashilusoppddxi';
if(url.hostname!==`db.${project}.supabase.co`) throw new Error('Only the isolated staging database is authorized');
// Require a valid certificate chain. Install a trusted CA through NODE_EXTRA_CA_CERTS if needed.
url.searchParams.delete('sslmode');
const client=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000});
const quote=s=>'"'+s.replaceAll('"','""')+'"';
try {
  await client.connect(); await client.query('begin isolation level repeatable read read only');
  await client.query("set local statement_timeout='30s'");
  const {rows:tables}=await client.query(`select c.relname as name,c.relrowsecurity as rls,
    (select count(*)::int from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' order by c.relname`);
  const output=[];
  for(const table of tables) {
    const hashes=[];
    await client.query(`declare manifest_rows no scroll cursor for select to_jsonb(t) as row from public.${quote(table.name)} t`);
    for(;;) {
      const batch=await client.query('fetch 500 from manifest_rows');if(!batch.rowCount)break;
      for(const {row} of batch.rows) hashes.push(sha256(canonical(row)));
    }
    await client.query('close manifest_rows');hashes.sort();
    output.push({...table,count:hashes.length,sha256:sha256(hashes.join('\n'))});
  }
  const {rows:constraints}=await client.query(`select c.conname as name,t.relname as table,c.convalidated as validated,pg_get_constraintdef(c.oid) as definition
    from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and c.contype='f' order by t.relname,c.conname`);
  await client.query('commit');
  console.log(JSON.stringify({format:1,tables:output,foreignKeys:constraints},null,2));
  if(constraints.some(c=>!c.validated)) process.exitCode=1;
} catch {console.error('Staging manifest failed; connection details and row contents suppressed. Check credentials, DNS and trusted CA.');process.exitCode=1;}
finally {await client.end().catch(()=>{});}
