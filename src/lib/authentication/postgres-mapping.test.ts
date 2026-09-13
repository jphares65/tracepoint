import {localPostgresPort} from '../../test-support/local-postgres-port.mjs';
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { PostgresIdentityMappingStore } from './postgres-mapping';
let postgres:EmbeddedPostgres,pool:pg.Pool,directory:string;
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
before(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'tracepoint-identity-test-'));const port=await localPostgresPort();
 postgres=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password:'local-test-only',port,persistent:true,postgresFlags:['-h','127.0.0.1'],initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});await postgres.initialise();await postgres.start();
 pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password:'local-test-only',database:'postgres'});
 await pool.query(`create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key);insert into profiles values('${user}'),('${other}');create table platform_admins(user_id uuid primary key references profiles(id),is_active boolean not null);create table department_memberships(user_id uuid not null references profiles(id),department_id uuid not null,is_active boolean not null)`);
 await pool.query(await readFile('supabase/migrations/202609050006_authentication_identity_links.sql','utf8'));
});
after(async()=>{await pool?.end();await postgres?.stop();if(directory){
 const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep));assert.ok(path.basename(resolved).startsWith('tracepoint-identity-test-'));
 await rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:100});await assert.rejects(access(resolved));
}});
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
test('only the initial-session boundary can promote a pending membership-less platform administrator',async()=>{
 const store=new PostgresIdentityMappingStore(pool);
 await pool.query("delete from authentication_identity_links");
 await pool.query("insert into platform_admins(user_id,is_active) values($1,true)",[other]);
 await pool.query("insert into authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state) values('cognito','platform-issuer','platform-subject',$1,'pending')",[other]);
 assert.equal(await store.findActive('platform-issuer','platform-subject'),null);
 assert.deepEqual(await store.activatePendingPlatformAdministrator('platform-issuer','platform-subject'),{userId:other});
 assert.deepEqual(await store.findActive('platform-issuer','platform-subject'),{userId:other});
 await pool.query("update authentication_identity_links set state='pending'");
 await pool.query("insert into department_memberships(user_id,department_id,is_active) values($1,'33333333-3333-4333-8333-333333333333',false)",[other]);
 assert.equal(await store.activatePendingPlatformAdministrator('platform-issuer','platform-subject'),null);
});
