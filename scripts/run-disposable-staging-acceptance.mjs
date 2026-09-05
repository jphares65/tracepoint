import { execFileSync, spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { validateStagingProviderConfig } from './validate-staging-provider-config.mjs';

// Only this script uses the staging admin key. Browser acceptance receives a
// generated password through its process environment, never the admin key.
if (!process.argv.includes('--execute')) throw new Error('Use --execute to create and remove disposable staging fixtures.');
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
const run = randomUUID();
const departmentIds = [randomUUID(), randomUUID()];
const email = 'acceptance-' + run + '@example.invalid';
const password = randomBytes(36).toString('base64url') + 'Aa1!';
let userId;
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
  console.log(JSON.stringify({ fixtureRun: run, stagingOnly: true, departments: departmentIds }));
  result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./test-staging-acceptance.mjs', import.meta.url)), '--smoke'], { env: { ...env, TRACEPOINT_ACCEPTANCE_EMAIL: email, TRACEPOINT_ACCEPTANCE_PASSWORD: password, TRACEPOINT_ACCEPTANCE_DEPARTMENT_ID: departmentIds[0], TRACEPOINT_ACCEPTANCE_FOREIGN_DEPARTMENT_ID: departmentIds[1], TRACEPOINT_ACCEPTANCE_WRITES: 'disposable-staging' }, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject); child.on('exit', code => resolve(code ?? 1));
  });
} catch {
  // Avoid SDK request/response details and credentials in logs.
  console.error('Disposable staging setup or execution failed; sensitive details suppressed.');
  result = 1;
} finally {
  let cleanupFailed = false;
  for (const id of createdDepartments) {
    const removal = await admin.from('departments').delete().eq('id', id).like('slug', 'acceptance-' + run + '-%');
    const verify = await admin.from('departments').select('id').eq('id', id);
    if (removal.error || verify.error || verify.data?.length !== 0) cleanupFailed = true;
  }
  if (userId) {
    const removal = await admin.auth.admin.deleteUser(userId);
    const verify = await admin.from('profiles').select('id').eq('id', userId);
    if (removal.error || verify.error || verify.data?.length !== 0) cleanupFailed = true;
  }
  console.log(JSON.stringify({ fixtureRun: run, cleanup: cleanupFailed ? 'FAILED: remove only this run identifiers' : 'verified' }));
  if (cleanupFailed) result = 1;
}
process.exitCode = result;
