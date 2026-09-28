import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySourceSecret, fingerprintSourceSecret } from './source-credential-epoch-core.mjs';

const projectRef = 'reukdouvpshshvqnzsgw';
const secret = value => JSON.stringify({ projectUrl: `https://${projectRef}.supabase.co`, serviceRoleKey: value });

test('classifies a modern secret without returning its value', () => {
  assert.equal(classifySourceSecret(secret(`sb_secret_${'x'.repeat(24)}`), projectRef), 'modern_secret');
  assert.equal(classifySourceSecret(`sb_secret_${'x'.repeat(24)}`, projectRef), 'modern_secret');
  assert.equal(fingerprintSourceSecret(`sb_secret_${'x'.repeat(24)}`, projectRef),
    fingerprintSourceSecret(secret(`sb_secret_${'x'.repeat(24)}`), projectRef));
});

test('classifies a legacy JWT candidate separately', () => {
  assert.equal(classifySourceSecret(secret(`eyJ${'x'.repeat(40)}`), projectRef), 'legacy_service_role_candidate');
});

test('fails closed on project or key mismatch', () => {
  assert.throws(() => classifySourceSecret(secret(`sb_secret_${'x'.repeat(24)}`), 'izlkwggluhlhzlumtzes'),
    /SOURCE_PROJECT_MISMATCH/);
  assert.throws(() => classifySourceSecret(secret('invalid'), projectRef),
    /SOURCE_ELEVATED_KEY_FORMAT_UNRECOGNIZED/);
});
