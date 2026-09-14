import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export const PRODUCTION_AUTH_VALIDATION_TARGET = Object.freeze({
  account: "193644343389",
  region: "us-east-1",
  profile: "tracepoint-production",
  rolePattern: /^arn:aws:sts::193644343389:assumed-role\/TracePointMigrationProduction\//,
  poolId: "us-east-1_diFmWDMe9",
  clientId: "9tfp383dgjuvanhnh94bstafr",
  issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_diFmWDMe9",
  managedLoginOrigin: "https://tracepoint-production-193644343389.auth.us-east-1.amazoncognito.com",
  applicationOrigin: "https://tracepointhq.com",
  loadBalancerDnsName: "tracep-Servi-HFH2HwVNXfys-2100776525.us-east-1.elb.amazonaws.com",
  cluster: "tracepoint-production",
  service: "tracepoint-production",
  runtimeTaskDefinition: "arn:aws:ecs:us-east-1:193644343389:task-definition/tracepointproductionruntimeServiceTaskDefA64ABA6A:3",
  runtimeImageDigest: "sha256:5f4b8fe59eaf8befd29bf7ca455ec1d4eb2b18836e66818bf2cc8cae55a90c0b",
  databaseTaskDefinition: "arn:aws:ecs:us-east-1:193644343389:task-definition/tracepoint-production-database-bootstrap:2",
  databaseImageDigest: "sha256:c8a84f687c251c5b169d79655408dd4c8448b2282421dcf45d395a952b265686",
  budgetName: "tracepoint-production-monthly",
  budgetUsd: 150,
  sourceMigrations: 76,
  awsOverlays: 21,
});

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const subject = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const kinds = ["ordinary", "admin", "foreign"];

export function createProductionAuthFixture() {
  const runId = randomUUID();
  const users = Object.fromEntries(kinds.map(kind => [kind, {
    kind,
    userId: randomUUID(),
    email: `aws-native-production-${kind}-${runId}@example.invalid`,
  }]));
  return validateProductionAuthFixture({ runId, users });
}

export function validateProductionAuthFixture(value) {
  assert.match(value?.runId ?? "", uuidV4);
  assert.deepEqual(Object.keys(value?.users ?? {}).sort(), [...kinds].sort());
  const ids = new Set();
  const emails = new Set();
  for (const kind of kinds) {
    const user = value.users[kind];
    assert.equal(user.kind, kind);
    assert.match(user.userId ?? "", uuidV4);
    assert.equal(user.email, `aws-native-production-${kind}-${value.runId}@example.invalid`);
    assert.ok(!ids.has(user.userId));
    assert.ok(!emails.has(user.email));
    ids.add(user.userId);
    emails.add(user.email);
    if (user.subject !== undefined) assert.match(user.subject, subject);
    if (user.username !== undefined) assert.match(user.username, subject);
  }
  assert.equal(ids.size, 3);
  assert.equal(emails.size, 3);
  return value;
}

export function resolveEcsLogStreamName({ taskArn, containerName, streamPrefix, reportedLogStreamName }) {
  if (reportedLogStreamName) return reportedLogStreamName;
  assert.match(taskArn ?? "", /^arn:aws:ecs:us-east-1:193644343389:task\/tracepoint-production\/[0-9a-f]{32}$/);
  assert.match(containerName ?? "", /^(tracepoint|bootstrap)$/);
  assert.match(streamPrefix ?? "", /^(web|database-bootstrap)$/);
  return `${streamPrefix}/${containerName}/${taskArn.slice(taskArn.lastIndexOf("/") + 1)}`;
}

export function runtimeCognitoAdminProgram() {
  return String.raw`(async()=>{
const c=require('crypto'),e=process.env,R='us-east-1',P='us-east-1_diFmWDMe9',H='cognito-idp.us-east-1.amazonaws.com';
const ok=(x,m)=>{if(!x)throw Error(m)},sha=x=>c.createHash('sha256').update(x).digest('hex'),mac=(k,x)=>c.createHmac('sha256',k).update(x).digest();
async function creds(){const u=e.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;ok(/^\/v2\/credentials\/[A-Za-z0-9-]+$/.test(u||''),'credentials');const r=await fetch('http://169.254.170.2'+u);ok(r.ok,'credentials');return r.json()}
async function call(op,body){const q=await creds(),p=JSON.stringify(body),d=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=d.slice(0,8),cType='application/x-amz-json-1.1',target='AWSCognitoIdentityProviderService.'+op,signed='content-type;host;x-amz-date;x-amz-security-token;x-amz-target',headers='content-type:'+cType+'\nhost:'+H+'\nx-amz-date:'+d+'\nx-amz-security-token:'+q.Token+'\nx-amz-target:'+target+'\n',request='POST\n/\n\n'+headers+'\n'+signed+'\n'+sha(p),scope=day+'/'+R+'/cognito-idp/aws4_request',toSign='AWS4-HMAC-SHA256\n'+d+'\n'+scope+'\n'+sha(request),key=mac(mac(mac(mac('AWS4'+q.SecretAccessKey,day),R),'cognito-idp'),'aws4_request'),sig=c.createHmac('sha256',key).update(toSign).digest('hex');const r=await fetch('https://'+H+'/',{method:'POST',headers:{'content-type':cType,'x-amz-date':d,'x-amz-security-token':q.Token,'x-amz-target':target,authorization:'AWS4-HMAC-SHA256 Credential='+q.AccessKeyId+'/'+scope+', SignedHeaders='+signed+', Signature='+sig},body:p});const v=await r.json().catch(()=>({}));if(!r.ok){const n=String(v.__type||v.code||'AwsError').split('#').pop();const x=Error(n);x.name=n;throw x}return v}
const op=e.TRACEPOINT_VALIDATION_OPERATION,kind=e.TRACEPOINT_VALIDATION_KIND,email=e.TRACEPOINT_VALIDATION_EMAIL;ok(['setup','global-signout','cleanup'].includes(op),'operation');ok(['ordinary','admin','foreign'].includes(kind),'kind');ok(email==='aws-native-production-'+kind+'-'+e.TRACEPOINT_VALIDATION_RUN_ID+'@example.invalid','email');let created=false;
try{if(op==='setup'){const password=c.randomBytes(48).toString('base64url')+'Aa1!';const made=await call('AdminCreateUser',{UserPoolId:P,Username:email,TemporaryPassword:password,MessageAction:'SUPPRESS',ForceAliasCreation:false,UserAttributes:[{Name:'email',Value:email},{Name:'email_verified',Value:'true'},{Name:'name',Value:'TracePoint Synthetic '+kind}]});created=true;await call('AdminSetUserPassword',{UserPoolId:P,Username:email,Password:password,Permanent:true});const found=await call('AdminGetUser',{UserPoolId:P,Username:email}),attrs=Object.fromEntries((found.UserAttributes||[]).map(x=>[x.Name,x.Value])),pem=Buffer.from(e.TRACEPOINT_VALIDATION_PUBLIC_KEY,'base64').toString();ok(attrs.email===email&&attrs.email_verified==='true','attributes');const sealed=c.publicEncrypt({key:pem,oaepHash:'sha256'},Buffer.from(password)).toString('base64');console.log(JSON.stringify({status:'PASSED',operation:op,kind,username:found.Username,subject:attrs.sub,sealedPassword:sealed,messageAction:'SUPPRESS',emailSent:false,credentialsPrinted:false}))}
else if(op==='global-signout'){await call('AdminUserGlobalSignOut',{UserPoolId:P,Username:email});console.log(JSON.stringify({status:'PASSED',operation:op,kind,emailSent:false,credentialsPrinted:false}))}
else{try{await call('AdminUserGlobalSignOut',{UserPoolId:P,Username:email})}catch(x){if(x.name!=='UserNotFoundException')throw x}try{await call('AdminDeleteUser',{UserPoolId:P,Username:email})}catch(x){if(x.name!=='UserNotFoundException')throw x}let absent=false;try{await call('AdminGetUser',{UserPoolId:P,Username:email})}catch(x){absent=x.name==='UserNotFoundException';if(!absent)throw x}ok(absent,'residue');console.log(JSON.stringify({status:'PASSED',operation:op,kind,userAbsent:true,emailSent:false,credentialsPrinted:false}))}}
catch(x){if(op==='setup'&&created)await call('AdminDeleteUser',{UserPoolId:P,Username:email}).catch(()=>{});console.error(JSON.stringify({status:'FAILED',operation:op,kind,errorName:x.name||'Error',sensitiveDetailsPrinted:false}));process.exitCode=1}
})()`;
}

export function databaseFixtureProgram(operation) {
  assert.ok(["setup", "cleanup"].includes(operation));
  const prefix = String.raw`const a=(x,m)=>{if(!x)throw Error(m)},e=process.env,pg=await import('pg'),fs=await import('node:fs/promises'),f=JSON.parse(Buffer.from(e.TRACEPOINT_VALIDATION_FIXTURE,'base64').toString()),U=Object.values(f.users),ids=U.map(x=>x.userId),D=[f.users.admin.userId,f.users.foreign.userId];a(e.AWS_REGION==='us-east-1'&&f.operation==='${operation}'&&/^[0-9a-f-]{36}$/.test(f.runId),'target');for(const x of U)a(x.email==='aws-native-production-'+x.kind+'-'+f.runId+'@example.invalid'&&/^[0-9a-f-]{36}$/.test(x.userId)&&/^[0-9a-f-]{36}$/.test(x.subject),'fixture');const meta=await fetch(e.ECS_CONTAINER_METADATA_URI_V4+'/task').then(r=>r.json());a(/^arn:aws:ecs:us-east-1:193644343389:task\//.test(meta.TaskARN)&&meta.Family==='tracepoint-production-database-bootstrap','task');const s=JSON.parse(e.TRACEPOINT_MIGRATOR_SECRET_JSON),ca=await fs.readFile(e.TRACEPOINT_DATABASE_CA_PATH,'utf8'),db=new pg.default.Client({host:s.host,port:5432,user:s.username,password:s.password,database:s.dbname,ssl:{ca,rejectUnauthorized:true},connectionTimeoutMillis:10000,statement_timeout:60000,application_name:'tracepoint-production-auth-validation'}),q=(x,v)=>db.query(x,v);let stage='connect';`;
const setup = String.raw`async function rls(user,own,foreign){await q('begin');try{await q('set local role authenticated');await q("select set_config('tracepoint.subject_id',$1,true)",[user]);const v=await q('select count(*)::int n from public.departments'),x=await q('select count(*)::int n from public.departments where id=$1',[foreign]),p=await q("select public.has_department_permission($1,'administer_department') allowed",[own]);await q('rollback');return[v.rows[0].n,x.rows[0].n,p.rows[0].allowed]}catch(x){await q('rollback');throw x}}try{await db.connect();stage='lineage';const l=await q('select kind,count(*)::int count from tracepoint_migrations.applied_migrations group by kind order by kind');a(JSON.stringify(l.rows)===JSON.stringify([{kind:'aws',count:21},{kind:'source',count:76}]),'lineage');stage='empty-target';const b=await q('select (select count(*) from auth.users)::int users,(select count(*) from public.departments)::int departments,(select count(*) from public.authentication_access_sessions)::int access_sessions,(select count(*) from public.authentication_refresh_sessions)::int refresh_sessions');a(Object.values(b.rows[0]).every(x=>x===0),'target-not-empty');await q('begin');await q('select pg_advisory_xact_lock(hashtext($1))',['tracepoint:production-auth-validation:'+f.runId]);for(const x of U){await q("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,jsonb_build_object('full_name',$3::text,'identity_provider','cognito'))",[x.userId,x.email,'TracePoint Synthetic '+x.kind]);await q('insert into public.profiles(id,full_name,email) values($1,$2,$3) on conflict(id) do update set full_name=excluded.full_name,email=excluded.email',[x.userId,'TracePoint Synthetic '+x.kind,x.email]);await q("insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state,provider_username) values('cognito',$1,$2,$3,'active',$4)",[f.issuer,x.subject,x.userId,x.username])}for(const k of ['admin','foreign']){const x=f.users[k],slug='aws-native-production-'+f.runId+'-'+k;await q('insert into public.departments(id,name,short_name,slug,created_by) values($1,$2,$3,$4,$1)',[x.userId,'SYNTHETIC AUTH VALIDATION '+k.toUpperCase(),'TEST',slug]);await q("insert into public.department_features(department_id,feature_code,is_enabled,enabled_at,updated_by) values($1,'equipment_readiness',true,clock_timestamp(),$1)",[x.userId])}for(const [k,d,r] of [['admin',f.users.admin.userId,'administrator'],['ordinary',f.users.admin.userId,'officer'],['foreign',f.users.foreign.userId,'officer']]){const x=f.users[k];await q("insert into public.department_memberships(department_id,user_id,is_active,activation_status) values($1,$2,true,'activated')",[d,x.userId]);await q('insert into public.department_membership_roles(department_id,user_id,role_code,assigned_by) values($1,$2,$3,$4)',[d,x.userId,r,f.users.admin.userId])}await q('commit');const A=await rls(f.users.admin.userId,D[0],D[1]),O=await rls(f.users.ordinary.userId,D[0],D[1]),F=await rls(f.users.foreign.userId,D[1],D[0]);a(JSON.stringify([A,O,F])===JSON.stringify([[1,0,true],[1,0,false],[1,0,false]]),'rls');console.log(JSON.stringify({status:'PASSED',operation:'setup',sourceMigrations:76,awsMigrations:21,users:3,departments:2,memberships:3,roles:3,features:2,businessRows:0,rls:true,crossTenantVisible:0,customerDataRead:false,credentialsPrinted:false}))}catch(x){await q('rollback').catch(()=>{});console.error(JSON.stringify({status:'FAILED',operation:f.operation,stage,errorName:x.name||'Error',errorCode:x.code,sensitiveDetailsPrinted:false}));process.exitCode=1}finally{await db.end().catch(()=>{})}`;
  const cleanup = String.raw`async function drop(ids){const t=await q("select quote_ident(n.nspname)||'.'||quote_ident(c.relname) t,quote_ident(g.tgname) g from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=g.tgfoid where not g.tgisinternal and n.nspname='public' and p.proname=any($1::text[])",[['write_audit_event','write_agency_training_audit_event']]);a(t.rowCount>0,'triggers');for(const x of t.rows)await q('alter table '+x.t+' disable trigger '+x.g);await q('delete from public.departments where id=any($1::uuid[])',[ids]);for(const x of t.rows)await q('alter table '+x.t+' enable trigger '+x.g)}try{await db.connect();stage='cleanup';await q('begin');await q('select pg_advisory_xact_lock(hashtext($1))',['tracepoint:production-auth-validation:'+f.runId]);const slugs=['aws-native-production-'+f.runId+'-admin','aws-native-production-'+f.runId+'-foreign'],exact=await q('select id,slug from public.departments where id=any($1::uuid[])',[D]);a(exact.rowCount===2&&exact.rows.every(x=>slugs.includes(x.slug)),'boundary');await q("select set_config('tracepoint.allow_department_teardown','on',true)");await q('delete from public.audit_events where department_id=any($1::uuid[])',[D]);await drop(D);await q('delete from auth.users where id=any($1::uuid[])',[ids]);await q('delete from public.authentication_flow_transactions where created_at>=to_timestamp($1)',[f.startedAtEpoch]);await q('commit');const z=await q('select (select count(*) from auth.users where id=any($1::uuid[]))::int users,(select count(*) from public.profiles where id=any($1::uuid[]))::int profiles,(select count(*) from public.authentication_identity_links where tracepoint_user_id=any($1::uuid[]))::int links,(select count(*) from public.departments where id=any($2::uuid[]))::int departments,(select count(*) from public.department_memberships where user_id=any($1::uuid[]) or department_id=any($2::uuid[]))::int memberships,(select count(*) from public.department_membership_roles where user_id=any($1::uuid[]) or department_id=any($2::uuid[]))::int roles,(select count(*) from public.department_features where department_id=any($2::uuid[]))::int features,(select count(*) from public.authentication_access_sessions where tracepoint_user_id=any($1::uuid[]))::int access_sessions,(select count(*) from public.authentication_refresh_sessions where tracepoint_user_id=any($1::uuid[]))::int refresh_sessions',[ids,D]);a(Object.values(z.rows[0]).every(x=>x===0),'residue');console.log(JSON.stringify({status:'PASSED',operation:'cleanup',residue:z.rows[0],syntheticOnly:true,customerDataRead:false,credentialsPrinted:false}))}catch(x){await q('rollback').catch(()=>{});console.error(JSON.stringify({status:'FAILED',operation:f.operation,stage,errorName:x.name||'Error',errorCode:x.code,sensitiveDetailsPrinted:false}));process.exitCode=1}finally{await db.end().catch(()=>{})}`;
  return `(async()=>{${prefix}${operation === "setup" ? setup : cleanup}})()`;
}

export function assertTaskOverrideSize(overrides) {
  const serialized = JSON.stringify(overrides);
  assert.ok(serialized.length <= 8192, `ECS override exceeds 8192 characters (${serialized.length}).`);
  return serialized;
}
