import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentityBatchManifest, identityCheckpoint, validateIdentityBatchManifest, validateIdentityCheckpoint } from './cognito-identity-batch-core.mjs';

const input = {
  actorUserId: '11111111-1111-4111-8111-111111111111', authorizationReference: 'STAGING-MIGRATION-2026', environment: 'staging', expectedAccount: '559054714699',
  siteUrl: 'https://staging.tracepointhq.com', userPoolId: 'us-east-1_Synthetic', clientId: 'syntheticclient', issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Synthetic', expiresAt: '2026-09-11T12:00:00.000Z', users: [{ departmentId: '22222222-2222-4222-8222-222222222222', targetUserId: '33333333-3333-4333-8333-333333333333' }],
};

test('creates an immutable UUID-only identity batch and resumable checkpoint', () => {
  const manifest = createIdentityBatchManifest(input, '2026-09-10T12:00:00.000Z');
  assert.equal(validateIdentityBatchManifest(manifest), manifest);
  const completed = new Set([manifest.users[0].itemSha256]);
  assert.deepEqual(validateIdentityCheckpoint(identityCheckpoint(manifest, completed), manifest), completed);
  assert.equal(JSON.stringify(manifest).includes('@'), false);
});

test('rejects mutation, duplicate users, site drift, and foreign checkpoints', () => {
  const manifest = createIdentityBatchManifest(input);
  assert.throws(() => validateIdentityBatchManifest({ ...manifest, actorUserId: '44444444-4444-4444-8444-444444444444' }), /integrity/);
  assert.throws(() => createIdentityBatchManifest({ ...input, users: [...input.users, ...input.users] }), /Duplicate/);
  assert.throws(() => createIdentityBatchManifest({ ...input, siteUrl: 'https://tracepointhq.com' }), /Site URL/);
  assert.throws(() => createIdentityBatchManifest({ ...input, expiresAt: '2026-09-12T12:00:01.000Z' }, '2026-09-10T12:00:00.000Z'), /expire/);
  assert.throws(() => validateIdentityCheckpoint({ format: 1, manifestSha256: 'x', completedItemSha256: [] }, manifest), /does not match/);
});
