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

const [{ execFileSync }, { getPostgresPool }, { provisionExistingCognitoUser, resumeExistingCognitoUserActivation }, { getCognitoMigrationDirectory }, { parseCognitoTargetConfiguration }] = await Promise.all([
  import('node:child_process'),
  import('../src/lib/database/postgres-pool.ts'),
  import('../src/lib/authentication/cognito-existing-user-migration.ts'),
  import('../src/lib/authentication/cognito-admin.ts'),
  import('../src/lib/authentication/cognito-runtime-configuration-core.ts'),
]);
let identity: { Account: string; Arn: string };
const metadataOrigin = process.env.ECS_CONTAINER_METADATA_URI_V4;
if (metadataOrigin) {
  assert.match(metadataOrigin, /^http:\/\/169\.254\.170\.2\/v4\/[A-Za-z0-9_-]+$/);
  const metadata = await fetch(`${metadataOrigin}/task`, { redirect: 'error', signal: AbortSignal.timeout(5000) }).then(async response => {
    assert.equal(response.status, 200);
    return response.json() as Promise<{ TaskARN?: string; Family?: string }>;
  });
  assert.match(metadata.TaskARN ?? '', new RegExp(`^arn:aws:ecs:us-east-1:${manifest.expectedAccount}:task/`), 'ECS task account does not match the manifest');
  assert.match(metadata.Family ?? '', new RegExp(`^tracepoint-${manifest.environment}-identity-migration-[0-9a-f-]{36}$`), 'ECS task family does not match the migration environment');
  identity = { Account: manifest.expectedAccount, Arn: metadata.TaskARN! };
} else {
  const command = process.platform === 'win32' ? 'aws.exe' : 'aws';
  identity = JSON.parse(execFileSync(command, ['sts', 'get-caller-identity', '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(identity.Account, manifest.expectedAccount, 'AWS identity does not match the manifest');
  if (manifest.environment === 'production') assert.match(identity.Arn, new RegExp(`^arn:aws:sts::${manifest.expectedAccount}:assumed-role/TracePointMigrationProduction/[^/]+$`));
}
const runtime = parseCognitoTargetConfiguration(process.env);
const runtimeIssuer = `https://cognito-idp.${runtime.verification.region}.amazonaws.com/${runtime.verification.userPoolId}`;
assert.deepEqual({ userPoolId: runtime.verification.userPoolId, clientId: runtime.verification.clientId, issuer: runtimeIssuer }, { userPoolId: manifest.userPoolId, clientId: manifest.clientId, issuer: manifest.issuer });

const pool = getPostgresPool();
const directory = getCognitoMigrationDirectory();
const stagingRecipients = new Set((process.env.TRACEPOINT_STAGING_IDENTITY_RECIPIENT_SHA256 ?? '').split(',').filter(value => /^[0-9a-f]{64}$/.test(value)));
if (manifest.environment === 'staging') assert.ok(stagingRecipients.size > 0, 'A reviewed staging recipient allowlist is required');
let migrated = 0;
let alreadyLinked = 0;
let skipped = 0;
for (const user of manifest.users) {
  if (completed.has(user.itemSha256)) { skipped += 1; continue; }
  const recipient = await pool.query('select lower(btrim(email)) as email from public.profiles where id=$1', [user.targetUserId]);
  if (recipient.rowCount !== 1 || !recipient.rows[0]?.email ||
      (manifest.environment === 'staging' && !stagingRecipients.has(createHash('sha256').update(String(recipient.rows[0].email)).digest('hex')))) {
    throw new Error('Identity migration recipient is unavailable or not approved for staging.');
  }
  const existing = await pool.query(
    `select l.issuer,l.subject,l.state,l.provider_username,p.email
     from public.authentication_identity_links l join public.profiles p on p.id=l.tracepoint_user_id
     where l.provider=$1 and l.tracepoint_user_id=$2 and l.state in ($3,$4)`,
    ['cognito', user.targetUserId, 'pending', 'active'],
  );
  if (Number(existing.rowCount) > 1 || existing.rows[0]?.issuer !== manifest.issuer) throw new Error('Cognito identity reconciliation failed.');
  if (existing.rows[0]) {
    const provider = await directory.get(user.targetUserId);
    const expectedStatus = existing.rows[0].state === 'active' ? 'CONFIRMED' : 'FORCE_CHANGE_PASSWORD';
    if (provider.username !== user.targetUserId || provider.subject !== existing.rows[0].subject ||
        provider.email !== String(existing.rows[0].email).trim().toLowerCase() || provider.enabled !== true ||
        provider.status !== expectedStatus || existing.rows[0].provider_username !== user.targetUserId) {
      throw new Error('Cognito directory and PostgreSQL identity state do not match.');
    }
  }
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
  `select l.tracepoint_user_id::text,l.issuer,l.subject,l.state,l.provider_username,p.email
   from public.authentication_identity_links l join public.profiles p on p.id=l.tracepoint_user_id
   where l.provider='cognito' and l.tracepoint_user_id=any($1::uuid[])
   order by l.tracepoint_user_id,l.issuer,l.subject`,
  [manifest.users.map((user: { targetUserId: string }) => user.targetUserId)],
)).rows;
assert.equal(mappings.length, manifest.users.length, 'Cognito mapping reconciliation count failed');
assert.ok(mappings.every(row => row.issuer === manifest.issuer && ['pending', 'active'].includes(row.state) && row.provider_username === row.tracepoint_user_id), 'Cognito mapping reconciliation failed');
const reconciled = [];
for (const mapping of mappings) {
  const provider = await directory.get(mapping.provider_username);
  const expectedStatus = mapping.state === 'active' ? 'CONFIRMED' : 'FORCE_CHANGE_PASSWORD';
  assert.deepEqual(
    { username: provider.username, subject: provider.subject, email: provider.email, enabled: provider.enabled, status: provider.status },
    { username: mapping.provider_username, subject: mapping.subject, email: String(mapping.email).trim().toLowerCase(), enabled: true, status: expectedStatus },
    'Cognito directory and PostgreSQL identity state do not match',
  );
  reconciled.push({ tracepointUserId: mapping.tracepoint_user_id, issuer: mapping.issuer, subject: mapping.subject, state: mapping.state, providerUsername: mapping.provider_username, providerStatus: provider.status });
}
const reconciliationSha256 = createHash('sha256').update(JSON.stringify(reconciled)).digest('hex');
await pool.end();
console.log(JSON.stringify({ manifestSha256: manifest.contentSha256, reconciliationSha256, total: manifest.users.length, migrated, alreadyLinked, skipped, completed: completed.size, emailAddressesPrinted: false, activationLinksPrinted: false }));
