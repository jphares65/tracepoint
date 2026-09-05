import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { PostgresIdentityMappingStore } from './postgres-mapping';
let postgres:EmbeddedPostgres,pool:pg.Pool,directory:string;
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
before(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'tracepoint-identity-test-'));const port=56000+Math.floor(Math.random()*4000);
 postgres=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password:'local-test-only',port,persistent:false,initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});await postgres.initialise();await postgres.start();
 pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password:'local-test-only',database:'postgres'});
 await pool.query(`create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key);insert into profiles values('${user}'),('${other}')`);
 await pool.query(await readFile('supabase/migrations/202609050006_authentication_identity_links.sql','utf8'));
});
after(async()=>{await pool?.end();await postgres?.stop();if(directory)await rm(directory,{recursive:true,force:true});});
test('pending mappings do not authenticate; activation and revocation persist',async()=>{
 const store=new PostgresIdentityMappingStore(pool);
 await pool.query("insert into authentication_identity_links(provider,issuer,subject,tracepoint_user_id) values('cognito','synthetic','subject',$1)",[user]);
 assert.equal(await store.findActive('synthetic','subject'),null);
 await pool.query("update authentication_identity_links set state='active'");assert.deepEqual(await store.findActive('synthetic','subject'),{userId:user});
 assert.equal(await store.findActive('foreign-issuer','subject'),null);
 await pool.query("update authentication_identity_links set state='revoked'");assert.equal(await store.findActive('synthetic','subject'),null);
});
test('duplicate subject and client mapping mutation cannot take over a stable user',async()=>{
 await assert.rejects(pool.query("insert into authentication_identity_links(provider,issuer,subject,tracepoint_user_id) values('cognito','synthetic','subject',$1)",[other]),/duplicate key/);
 const client=await pool.connect();try{await client.query('set role authenticated');await assert.rejects(client.query('select * from authentication_identity_links'),/permission denied/);await assert.rejects(client.query("update authentication_identity_links set state='active'"),/permission denied/);}finally{await client.query('reset role');client.release();}
});
