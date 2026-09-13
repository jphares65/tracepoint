import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

import { identityCheckpoint, validateExceptionalIdentityBatchManifest, validateIdentityCheckpoint } from './cognito-identity-batch-core.mjs';

const args = process.argv.slice(2);
const value = (name: string) => { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1] ?? ''; };
const manifestPath = value('--manifest');
const checkpointPath = value('--checkpoint');
assert.ok(manifestPath && checkpointPath, '--manifest and --checkpoint are required');
const manifest = validateExceptionalIdentityBatchManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
assert.ok(Date.now() < Date.parse(manifest.expiresAt), 'Identity migration authorization has expired');
assert.equal(process.env.TRACEPOINT_IDENTITY_MIGRATION_AUTHORIZATION, `${manifest.authorizationReference}:${manifest.contentSha256}`, 'Manifest-specific identity migration authorization is required');
assert.ok(args.includes('--execute'), 'Dry run only. Add --execute under the reviewed authorization.');
assert.ok(args.includes('--acknowledge-cognito-writes'), 'Cognito write acknowledgement is required');
assert.equal(process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE, 'aws-native');
assert.equal(process.env.TRACEPOINT_DATA_PROVIDER, 'postgres');
assert.equal(process.env.TRACEPOINT_AUTH_PROVIDER, 'cognito');

let checkpointJson: unknown = null;
try { checkpointJson = JSON.parse(await readFile(checkpointPath, 'utf8')); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const completed = validateIdentityCheckpoint(checkpointJson, manifest);
const [{ provisionExceptionalCognitoUser, readExceptionalCognitoMigration }, { getCognitoMigrationDirectory }, { parseCognitoTargetConfiguration }] = await Promise.all([
  import('../src/lib/authentication/cognito-exceptional-identity-migration.ts'),
  import('../src/lib/authentication/cognito-admin.ts'),
  import('../src/lib/authentication/cognito-runtime-configuration-core.ts'),
]);
const runtime = parseCognitoTargetConfiguration(process.env);
const issuer = `https://cognito-idp.${runtime.verification.region}.amazonaws.com/${runtime.verification.userPoolId}`;
assert.deepEqual({ userPoolId: runtime.verification.userPoolId, clientId: runtime.verification.clientId, issuer }, { userPoolId: manifest.userPoolId, clientId: manifest.clientId, issuer: manifest.issuer });
const directory = getCognitoMigrationDirectory();
let migrated = 0;
let skipped = 0;
for (const user of manifest.users) {
  if (completed.has(user.itemSha256)) { skipped += 1; continue; }
  await provisionExceptionalCognitoUser({ actorUserId: manifest.actorUserId, targetUserId: user.targetUserId, disposition: user.disposition });
  migrated += 1;
  completed.add(user.itemSha256);
  const temporaryPath = `${checkpointPath}.new`;
  await writeFile(temporaryPath, `${JSON.stringify(identityCheckpoint(manifest, completed), null, 2)}\n`, { flag: 'w', mode: 0o600 });
  await rename(temporaryPath, checkpointPath);
}
const reconciled = [];
for (const user of manifest.users) {
  const mapping = await readExceptionalCognitoMigration({ actorUserId: manifest.actorUserId, targetUserId: user.targetUserId, disposition: user.disposition });
  assert.ok(mapping.issuer === manifest.issuer && mapping.providerUsername === user.targetUserId, 'Exceptional Cognito mapping reconciliation failed');
  const expectedState = user.disposition === 'inactive-disabled' ? 'revoked' : 'pending';
  assert.equal(mapping.state, expectedState, 'Exceptional Cognito link state is invalid');
  const provider = await directory.get(user.targetUserId);
  assert.equal(provider.subject, mapping.subject, 'Exceptional Cognito subject reconciliation failed');
  assert.equal(provider.status, 'FORCE_CHANGE_PASSWORD', 'Exceptional Cognito status reconciliation failed');
  assert.equal(provider.enabled, user.disposition === 'platform-administrator', 'Exceptional Cognito enabled state reconciliation failed');
  reconciled.push({ disposition: user.disposition, issuer: mapping.issuer, state: mapping.state, providerEnabled: provider.enabled, providerStatus: provider.status });
}
const reconciliationSha256 = createHash('sha256').update(JSON.stringify(reconciled)).digest('hex');
console.log(JSON.stringify({ manifestSha256: manifest.contentSha256, reconciliationSha256, total: manifest.users.length, migrated, skipped, completed: completed.size, activationEmailsSent: 0, emailAddressesPrinted: false, userIdsPrinted: false }));
