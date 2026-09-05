import {exerciseAuthRecovery} from './staging-auth-recovery-scenario.mjs';
import {exerciseStorageCopy} from './staging-storage-copy-scenario.mjs';
import {S3Client,ListObjectVersionsCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { validateStagingProviderConfig } from './validate-staging-provider-config.mjs';

// Only this script uses the staging admin key. Browser acceptance receives a
// generated password through its process environment, never the admin key.
if (!process.argv.includes('--execute')) throw new Error('Use --execute to create and remove disposable staging fixtures.');
if((process.argv.includes('--auth-recovery')||process.argv.includes('--browser-recovery'))&&!process.argv.includes('--fixtures-only'))throw new Error('Standalone recovery requires --fixtures-only so subsequent login credentials are not invalidated.');
const env = { ...process.env, AWS_REGION: 'us-east-1', AWS_DEFAULT_REGION: 'us-east-1' };
function aws(args) {
  return JSON.parse(execFileSync('aws.exe', [...args, '--region', 'us-east-1', '--output', 'json'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}
const identity = aws(['sts', 'get-caller-identity']);
assert.equal(identity.Account, '559054714699');
assert.match(identity.Arn, new RegExp('^arn:aws:sts::559054714699:assumed-role/[^/]*TracePointMigrationStaging[^/]*/')); 
let secret;
try { secret = JSON.parse(aws(['secretsmanager', 'get-secret-value', '--secret-id', 'tracepoint/staging/application']).SecretString); }
catch { throw new Error('Unable to read valid staging application secret JSON'); }
assert.equal(secret.NEXT_PUBLIC_SUPABASE_URL, 'https://wztqqqashilusoppddxi.supabase.co');
assert.equal(secret.NEXT_PUBLIC_SITE_URL, 'https://staging.tracepointhq.com');
assert.equal(secret.CONFIGURATION_ENVIRONMENT, 'staging');
assert.ok(secret.SUPABASE_SECRET_KEY);
try { await validateStagingProviderConfig(secret, fetch, { email: false }); }
catch (error) { console.error(error.message); process.exit(1); }
const admin = createClient(secret.NEXT_PUBLIC_SUPABASE_URL, secret.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const service=aws(['ecs','describe-services','--cluster','tracepoint-staging','--services','tracepoint-staging']).services[0];
const task=aws(['ecs','describe-task-definition','--task-definition',service.taskDefinition]).taskDefinition;
const storageProvider=task.containerDefinitions[0].environment.find(x=>x.name==='TRACEPOINT_STORAGE_PROVIDER')?.value;
const run = randomUUID();
const departmentIds = [randomUUID(), randomUUID()];
const email = 'acceptance-' + run + '@example.invalid';
const password = randomBytes(36).toString('base64url') + 'Aa1!';
let userId;
const extraUsers=[];
const officerEmail='officer-'+run+'@example.invalid';
const officerPassword=randomBytes(36).toString('base64url')+'Aa1!';
const createdDepartments = [];
let result = 1;
function requireSuccess(value, label) { if (value.error) { console.error(JSON.stringify({step: label, code: value.error.code ?? value.error.status ?? 'unknown'})); throw new Error('Fixture request failed'); } return value.data; }
try {
  const user = requireSuccess(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Disposable staging acceptance' } }), 'Create disposable user');
  userId = user.user.id;
  requireSuccess(await admin.from('profiles').upsert({ id: userId, full_name: 'Disposable staging acceptance', email }), 'Prepare profile');
  for (const [i, id] of departmentIds.entries()) {
    requireSuccess(await admin.from('departments').insert({ id, name: 'Disposable acceptance ' + run + '-' + i, slug: 'acceptance-' + run + '-' + i }), 'Create disposable department');
    createdDepartments.push(id);
  }
  requireSuccess(await admin.from('department_memberships').insert({ department_id: departmentIds[0], user_id: userId, is_active: true }), 'Create membership');
  requireSuccess(await admin.from('department_membership_roles').insert({ department_id: departmentIds[0], user_id: userId, role_code: 'administrator' }), 'Create manager role');
  if(process.argv.includes('--extended-workflows'))requireSuccess(await admin.from('department_membership_roles').insert({department_id:departmentIds[0],user_id:userId,role_code:'chief'}),'Create disposable command role');
  for(const [index,departmentId] of departmentIds.entries()) {
    const extra = requireSuccess(await admin.auth.admin.createUser({email:index===0?officerEmail:'foreign-'+run+'@example.invalid',password:officerPassword,email_confirm:true}), 'Create disposable officer');
    extraUsers.push(extra.user.id);
    requireSuccess(await admin.from('profiles').upsert({id:extra.user.id,full_name:'Disposable acceptance officer'}), 'Officer profile');
    requireSuccess(await admin.from('department_memberships').insert({department_id:departmentId,user_id:extra.user.id,is_active:true}), 'Officer membership');
    requireSuccess(await admin.from('department_membership_roles').insert({department_id:departmentId,user_id:extra.user.id,role_code:'officer'}), 'Officer role');
  }
  const features = requireSuccess(await admin.from('feature_catalog').select('code').eq('is_active',true), 'Load feature codes');
  requireSuccess(await admin.from('department_features').insert(features.map(f=>({department_id:departmentIds[0],feature_code:f.code,is_enabled:true}))), 'Enable disposable department features');
  console.log(JSON.stringify({ fixtureRun: run, stagingOnly: true, departments: departmentIds }));
  if(process.argv.includes('--auth-recovery')||process.argv.includes('--browser-recovery'))await exerciseAuthRecovery({admin,url:secret.NEXT_PUBLIC_SUPABASE_URL,publicKey:secret.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,email,userId,browserRecovery:process.argv.includes('--browser-recovery')});
  if(process.argv.includes('--storage-migration'))await exerciseStorageCopy({admin,department:departmentIds[0],env,run});
  result = process.argv.includes('--fixtures-only') ? 0 : await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./test-staging-acceptance.mjs', import.meta.url)), '--smoke'], { env: { ...env, TRACEPOINT_ACCEPTANCE_EXTENDED_WORKFLOWS:process.argv.includes('--extended-workflows')?'enabled':'', TRACEPOINT_ACCEPTANCE_RANGE_DOCUMENTS:process.argv.includes('--range-documents')?'enabled':'', TRACEPOINT_ACCEPTANCE_STORAGE_PROVIDER:storageProvider, TRACEPOINT_ACCEPTANCE_FOREIGN_EMAIL:'foreign-'+run+'@example.invalid', TRACEPOINT_ACCEPTANCE_MANAGER_ID:userId, TRACEPOINT_ACCEPTANCE_OFFICER_ID:extraUsers[0], TRACEPOINT_ACCEPTANCE_FOREIGN_USER_ID:extraUsers[1], TRACEPOINT_ACCEPTANCE_OFFICER_EMAIL:officerEmail, TRACEPOINT_ACCEPTANCE_OFFICER_PASSWORD:officerPassword, TRACEPOINT_ACCEPTANCE_EMAIL: email, TRACEPOINT_ACCEPTANCE_PASSWORD: password, TRACEPOINT_ACCEPTANCE_DEPARTMENT_ID: departmentIds[0], TRACEPOINT_ACCEPTANCE_FOREIGN_DEPARTMENT_ID: departmentIds[1], TRACEPOINT_ACCEPTANCE_WRITES: 'disposable-staging' }, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject); child.on('exit', code => resolve(code ?? 1));
  });
  if(result===0&&!process.argv.includes('--fixtures-only')) {
    if(process.argv.includes('--extended-workflows'))await exerciseAuthRecovery({admin,url:secret.NEXT_PUBLIC_SUPABASE_URL,publicKey:secret.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,email,userId,browserRecovery:true});
    const history=requireSuccess(await admin.from('equipment_asset_assignments').select('returned_at').eq('department_id',departmentIds[0]), 'Verify custody history');
    const audit=requireSuccess(await admin.from('audit_events').select('id').eq('department_id',departmentIds[0]).eq('entity_type','equipment_assets'), 'Verify audit creation');
    assert.ok(history.length>=2&&history.every(x=>x.returned_at));assert.ok(audit.length>=3);
    if(process.argv.includes('--range-documents')){
      const documents=requireSuccess(await admin.from('audit_events').select('id').eq('department_id',departmentIds[0]).eq('entity_type','drill_document'), 'Document audit verification');assert.ok(documents.length>=2);
      console.log(JSON.stringify({fixtureRun:run,documentAudit:'verified'}));
    }
    console.log(JSON.stringify({fixtureRun:run,custodyHistory:'verified',auditCreation:'verified'}));
  }
} catch {
  // Avoid SDK request/response details and credentials in logs.
  console.error('Disposable staging setup or execution failed; sensitive details suppressed.');
  result = 1;
} finally {
  let cleanupFailed = false;
  if(storageProvider==='s3'){
    const storage=new S3Client({region:'us-east-1',maxAttempts:1});
    try{
      const cleanupIdentity=aws(['sts','get-caller-identity']);assert.equal(cleanupIdentity.Account,'559054714699');assert.ok(cleanupIdentity.Arn.includes('TracePointMigrationStaging'));
      const target={Bucket:'tracepoint-staging-private-559054714699',ExpectedBucketOwner:'559054714699'};
      for(const id of createdDepartments)for(const Prefix of ['attachments/'+id+'/','department-assets/'+id+'/']){
        const versions=await storage.send(new ListObjectVersionsCommand({...target,Prefix}));assert.ok(!versions.IsTruncated);
        for(const item of [...versions.Versions??[],...versions.DeleteMarkers??[]]){assert.ok(item.Key?.startsWith(Prefix)&&item.VersionId);await storage.send(new DeleteObjectCommand({...target,Key:item.Key,VersionId:item.VersionId}));}
        const remaining=await storage.send(new ListObjectVersionsCommand({...target,Prefix}));assert.equal((remaining.Versions?.length??0)+(remaining.DeleteMarkers?.length??0),0);
      }
      console.log(JSON.stringify({fixtureRun:run,storageCleanup:'verified zero fixture versions'}));
    }catch{cleanupFailed=true;}finally{storage.destroy();}
  }
  for(const id of createdDepartments) for(const table of [...(process.argv.includes('--extended-workflows')?['firearm_inspections','firearm_assignments','firearms','training_certifications','certification_types','notification_events','off_duty_firearm_inspections','off_duty_firearm_history','off_duty_request_actions','off_duty_firearm_requests','fleet_vehicle_inspections','fleet_work_orders','fleet_vehicle_equipment','fleet_vehicle_documents','fleet_vehicles','fleet_rules','agency_training_attendees','agency_training_event_instructors','agency_training_events','agency_training_course_aliases','agency_training_courses']:[]),...(process.argv.includes('--range-documents')?['drill_documents','pilot_range_workspaces']:[]),'equipment_asset_assignments','equipment_assets','equipment_types']) {
    const removal=await admin.from(table).delete().eq('department_id',id);
    const verify=await admin.from(table).select('department_id').eq('department_id',id);
    if(removal.error||verify.error||verify.data?.length!==0)cleanupFailed=true;
  }
  for (const createdUserId of [userId,...extraUsers].filter(Boolean)) {
    const removal = await admin.auth.admin.deleteUser(createdUserId);
    const verify = await admin.from('profiles').select('id').eq('id', createdUserId);
    if (removal.error || verify.error || verify.data?.length !== 0) cleanupFailed = true;
  }
  for (const id of createdDepartments) {
    // Delete auto-seeded audited children while the tenant still exists. A
    // parent-first cascade would make their audit inserts violate the tenant FK.
    for (const table of ['department_feature_events', 'department_features', 'department_role_permissions', 'department_rules', 'department_security_settings']) {
      const removal = await admin.from(table).delete().eq('department_id', id);
      if (removal.error) cleanupFailed = true;
    }
    const removal = await admin.from('departments').delete().eq('id', id).like('slug', 'acceptance-' + run + '-%');
    const verify = await admin.from('departments').select('id').eq('id', id);
    if (removal.error || verify.error || verify.data?.length !== 0) cleanupFailed = true;
  }
  console.log(JSON.stringify({ fixtureRun: run, cleanup: cleanupFailed ? 'FAILED: remove only this run identifiers' : 'verified' }));
  if (cleanupFailed) result = 1;
}
process.exitCode = result;
