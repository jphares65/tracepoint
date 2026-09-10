import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

import { identityCheckpoint, validateIdentityBatchManifest, validateIdentityCheckpoint } from './cognito-identity-batch-core.mjs';

const args = process.argv.slice(2);
const value = (name: string) => { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1] ?? ''; };
const manifestPath = value('--manifest');
const checkpointPath = value('--checkpoint');
assert.ok(manifestPath && checkpointPath, '--manifest and --checkpoint are required');
const manifest = validateIdentityBatchManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
assert.ok(Date.now() < Date.parse(manifest.expiresAt), 'Identity migration authorization has expired');

const approval = process.env.TRACEPOINT_IDENTITY_MIGRATION_AUTHORIZATION;
const expectedApproval = `${manifest.authorizationReference}:${manifest.contentSha256}`;
assert.equal(approval, expectedApproval, 'Manifest-specific identity migration authorization is required');
assert.ok(args.includes('--execute'), 'Dry run only. Add --execute under the reviewed authorization.');
assert.ok(args.includes('--acknowledge-cognito-writes'), 'Cognito write acknowledgement is required');
assert.ok(args.includes('--acknowledge-email-send'), 'SES activation-message acknowledgement is required');
assert.equal(process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE, 'aws-native');
assert.equal(process.env.TRACEPOINT_DATA_PROVIDER, 'postgres');
assert.equal(process.env.TRACEPOINT_AUTH_PROVIDER, 'cognito');
assert.equal(process.env.TRACEPOINT_EMAIL_PROVIDER, 'ses');

let checkpointJson: unknown = null;
try { checkpointJson = JSON.parse(await readFile(checkpointPath, 'utf8')); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const completed = validateIdentityCheckpoint(checkpointJson, manifest);

const [{ execFileSync }, { getPostgresPool }, { provisionExistingCognitoUser, resumeExistingCognitoUserActivation }, { parseCognitoRuntimeConfiguration }] = await Promise.all([
  import('node:child_process'),
  import('../src/lib/database/postgres-pool.ts'),
  import('../src/lib/authentication/cognito-existing-user-migration.ts'),
  import('../src/lib/authentication/cognito-runtime-configuration-core.ts'),
]);
const command = process.platform === 'win32' ? 'aws.exe' : 'aws';
const identity = JSON.parse(execFileSync(command, ['sts', 'get-caller-identity', '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
assert.equal(identity.Account, manifest.expectedAccount, 'AWS identity does not match the manifest');
if (manifest.environment === 'production') assert.match(identity.Arn, new RegExp(`^arn:aws:sts::${manifest.expectedAccount}:assumed-role/TracePointMigrationProduction/[^/]+$`));
const runtime = parseCognitoRuntimeConfiguration(process.env);
const runtimeIssuer = `https://cognito-idp.${runtime.verification.region}.amazonaws.com/${runtime.verification.userPoolId}`;
assert.deepEqual({ userPoolId: runtime.verification.userPoolId, clientId: runtime.verification.clientId, issuer: runtimeIssuer }, { userPoolId: manifest.userPoolId, clientId: manifest.clientId, issuer: manifest.issuer });

const pool = getPostgresPool();
let migrated = 0;
let alreadyLinked = 0;
let skipped = 0;
for (const user of manifest.users) {
  if (completed.has(user.itemSha256)) { skipped += 1; continue; }
  const existing = await pool.query('select issuer,state from public.authentication_identity_links where provider=$1 and tracepoint_user_id=$2 and state in ($3,$4)', ['cognito', user.targetUserId, 'pending', 'active']);
  if (Number(existing.rowCount) > 1 || existing.rows[0]?.issuer !== manifest.issuer) throw new Error('Cognito identity reconciliation failed.');
  if (existing.rows[0]?.state === 'active') {
    alreadyLinked += 1;
  } else if (existing.rows[0]?.state === 'pending') {
    await resumeExistingCognitoUserActivation({ actorUserId: manifest.actorUserId, departmentId: user.departmentId, targetUserId: user.targetUserId, siteUrl: manifest.siteUrl });
    migrated += 1;
  } else {
    await provisionExistingCognitoUser({ actorUserId: manifest.actorUserId, departmentId: user.departmentId, targetUserId: user.targetUserId, siteUrl: manifest.siteUrl });
    migrated += 1;
  }
  completed.add(user.itemSha256);
  const temporaryPath = `${checkpointPath}.new`;
  await writeFile(temporaryPath, `${JSON.stringify(identityCheckpoint(manifest, completed), null, 2)}\n`, { flag: 'w', mode: 0o600 });
  await rename(temporaryPath, checkpointPath);
}
const mappings = (await pool.query(
  `select tracepoint_user_id::text,issuer,subject,state,provider_username
   from public.authentication_identity_links where provider='cognito' and tracepoint_user_id=any($1::uuid[])
   order by tracepoint_user_id,issuer,subject`,
  [manifest.users.map((user: { targetUserId: string }) => user.targetUserId)],
)).rows;
assert.equal(mappings.length, manifest.users.length, 'Cognito mapping reconciliation count failed');
assert.ok(mappings.every(row => row.issuer === manifest.issuer && ['pending', 'active'].includes(row.state) && row.provider_username === row.tracepoint_user_id), 'Cognito mapping reconciliation failed');
const reconciliationSha256 = createHash('sha256').update(JSON.stringify(mappings)).digest('hex');
await pool.end();
console.log(JSON.stringify({ manifestSha256: manifest.contentSha256, reconciliationSha256, total: manifest.users.length, migrated, alreadyLinked, skipped, completed: completed.size, emailAddressesPrinted: false, activationLinksPrinted: false }));
