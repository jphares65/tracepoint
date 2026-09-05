import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { catalogSql, manifestSql } from './staging-management-manifest.mjs';
let server,client,directory;
before(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'tracepoint-manifest-test-'));const port=56000+Math.floor(Math.random()*4000);
 server=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password:'local-test-only',port,persistent:false,initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});
 await server.initialise();await server.start();client=new pg.Client({host:'127.0.0.1',port,user:'postgres',password:'local-test-only',database:'postgres'});await client.connect();
 await client.query(`create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text);insert into supabase_migrations.schema_migrations values('202601010001');
 create table parents(id serial primary key);create table children(id serial primary key,parent_id integer references parents(id),value text);
 insert into parents default values;insert into children(parent_id,value) values(1,'synthetic'),(1,'synthetic');alter table children enable row level security;`);
});
after(async()=>{await client?.end();await server?.stop();if(directory)await rm(directory,{recursive:true,force:true});});
async function manifest(catalog){const result=await client.query(manifestSql(catalog??(await client.query(catalogSql)).rows[0],['202601010001']));return result.find(x=>x.rows[0]?.manifest)?.rows[0].manifest;}
test('real PostgreSQL manifests reconcile and detect row-content changes without exporting rows',async()=>{
 const first=await manifest();assert.deepEqual(await manifest(),first);assert.equal(first.tables.find(x=>x.name==='children').count,2);assert.equal(first.relationships[0].orphan_count,0);
 assert.equal(JSON.stringify(first).includes('synthetic'),false);
 await client.query("update children set value='changed' where id=1");const changed=await manifest();assert.notEqual(first.tables.find(x=>x.name==='children').sha256,changed.tables.find(x=>x.name==='children').sha256);
});
test('RLS policy and schema changes alter metadata fingerprints',async()=>{
 const first=await manifest();await client.query('create policy visible on children for select using(true)');const changed=await manifest();assert.notEqual(first.metadata.policies,changed.metadata.policies);
 await client.query('alter table children add column detail text');assert.notEqual(changed.metadata.columns,(await manifest()).metadata.columns);
});
test('ledger and catalog drift fail closed without mutations',async()=>{
 const catalog=(await client.query(catalogSql)).rows[0];await client.query("insert into supabase_migrations.schema_migrations values('202601010002')");
 await assert.rejects(manifest(catalog),/Unexpected migration ledger/);await client.query('rollback');
 await client.query("delete from supabase_migrations.schema_migrations where version='202601010002'");
 await client.query('create table extra(id integer)');await assert.rejects(manifest(catalog),/Catalog changed/);await client.query('rollback');
});
