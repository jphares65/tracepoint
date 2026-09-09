import {localPostgresPort} from '../../test-support/local-postgres-port.mjs';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import { parseSesFeedback, recipientHash } from './ses-feedback';
import { PostgresSesFeedbackStore } from './ses-feedback-postgres';

const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
const email='synthetic@example.invalid', foreign='foreign@example.invalid';
let postgres: EmbeddedPostgres, pool: pg.Pool, store: PostgresSesFeedbackStore, directory: string;
before(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'tracepoint-ses-test-'));
 const port=await localPostgresPort();
 // Own cleanup so Windows child-handle release can use bounded retries.
 postgres=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password:'local-test-only',port,persistent:true,postgresFlags:['-h','127.0.0.1'],initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});
 await postgres.initialise();await postgres.start();
 pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password:'local-test-only',database:'postgres'});
 await pool.query(`create role anon; create role authenticated; create role service_role;
 create table public.departments(id uuid primary key); insert into departments values('${a}'),('${b}');`);
 await pool.query(await readFile('supabase/migrations/202609050005_ses_feedback_persistence.sql','utf8'));
 store=new PostgresSesFeedbackStore(pool);
});
after(async()=>{await pool?.end();await postgres?.stop();if(directory){
 const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep));assert.ok(path.basename(resolved).startsWith('tracepoint-ses-test-'));
 await rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:100});await assert.rejects(access(resolved));
}});
function feedback(kind='Bounce',recipient=email,messageId='accepted-1') {
 return parseSesFeedback({notificationId:'sns-1',topicArn:'arn:aws:sns:us-east-1:559054714699:feedback',message:JSON.stringify({eventType:kind,
 mail:{sendingAccountId:'559054714699',messageId,tags:{department:[b]}},
 bounce:{bouncedRecipients:[{emailAddress:recipient}]},complaint:{complainedRecipients:[{emailAddress:recipient}]},delivery:{recipients:[recipient]}})},'559054714699');
}
test('persistent bounce suppresses and duplicate is idempotent across store instances',async()=>{
 await store.recordAcceptance('accepted-1',a,[email]);assert.equal(await store.isSuppressed(email),false);
 assert.equal(await store.apply(feedback()),'applied');assert.equal(await new PostgresSesFeedbackStore(pool).isSuppressed(email),true);
 assert.equal(await store.apply(feedback()),'duplicate');
 const result=await pool.query('select department_id from email_provider_events');assert.equal(result.rows[0].department_id,a);
});
test('complaint remains suppressed after delivery and tenant deletion',async()=>{
 assert.equal(await store.apply(feedback('Complaint')),'applied');assert.equal(await store.apply(feedback('Delivery')),'applied');
 assert.equal((await pool.query('select reason from email_suppressions')).rows[0].reason,'Complaint');
 await pool.query('delete from departments where id=$1',[a]);assert.equal(await store.isSuppressed(email),true);
});
test('unknown messages and unrelated recipient hashes cannot mutate suppression',async()=>{
 await store.recordAcceptance('accepted-2',b,[foreign]);
 await assert.rejects(store.apply(feedback('Bounce',email,'accepted-2')),/persistence failed/);
 await assert.rejects(store.apply(feedback('Bounce',foreign,'unknown')),/persistence failed/);
 assert.equal(await store.isSuppressed(foreign),false);
 await assert.rejects(store.recordAcceptance('accepted-2',b,[email]),/mapping conflict/);
});
test('authenticated clients cannot read or modify feedback state',async()=>{
 const client=await pool.connect();try {
  await client.query('set role authenticated');
  for(const table of ['email_provider_acceptances','email_provider_events','email_suppressions']) await assert.rejects(client.query(`select * from ${table}`),/permission denied/);
 } finally {await client.query('reset role');client.release();}
});
test('malformed events and wrong account fail with sanitized messages',()=>{
 for(const message of ['{}','private-invalid-json',JSON.stringify({eventType:'Bounce',mail:{sendingAccountId:'265544358665',messageId:'x'}})])
  assert.throws(()=>parseSesFeedback({notificationId:'x',topicArn:'x',message},'559054714699'),/^Error: Malformed SES feedback; contents suppressed\.$/);
 assert.equal(recipientHash('SYNTHETIC@example.invalid'),recipientHash(email));
});

test('late provider feedback cannot replace a deliberate opt-out or its provenance',async()=>{
 const recipient='optout@example.invalid';await store.recordAcceptance('accepted-optout',b,[recipient]);
 await pool.query("insert into email_suppressions(recipient_hash,reason,source_event_id) values($1,'OptOut',null)",[recipientHash(recipient)]);
 for(const kind of ['Bounce','Complaint'])await store.apply(feedback(kind,recipient,'accepted-optout'));
 const row=(await pool.query('select reason,source_event_id from email_suppressions where recipient_hash=$1',[recipientHash(recipient)])).rows[0];
 assert.deepEqual(row,{reason:'OptOut',source_event_id:null});assert.equal(await store.isSuppressed(recipient),true);
});

test('a late bounce cannot relabel the event that caused complaint suppression',async()=>{
 const recipient='complaint@example.invalid';await store.recordAcceptance('accepted-complaint',b,[recipient]);
 const complaint=feedback('Complaint',recipient,'accepted-complaint');await store.apply(complaint);await store.apply(feedback('Bounce',recipient,'accepted-complaint'));
 const row=(await pool.query('select reason,source_event_id from email_suppressions where recipient_hash=$1',[recipientHash(recipient)])).rows[0];
 assert.deepEqual(row,{reason:'Complaint',source_event_id:complaint.eventId});
});
