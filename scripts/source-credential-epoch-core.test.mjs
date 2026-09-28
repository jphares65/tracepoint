import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTION_EPOCH, classifySourceSecret, fingerprintSourceSecret } from './source-credential-epoch-core.mjs';

const projectRef = 'reukdouvpshshvqnzsgw';
const secret = value => JSON.stringify({ projectUrl: `https://${projectRef}.supabase.co`, serviceRoleKey: value });

test('classifies a modern secret without returning its value', () => {
  assert.equal(classifySourceSecret(secret(`sb_secret_${'x'.repeat(24)}`), projectRef), 'modern_secret');
  assert.equal(classifySourceSecret(`sb_secret_${'x'.repeat(24)}`, projectRef), 'modern_secret');
  assert.equal(fingerprintSourceSecret(`sb_secret_${'x'.repeat(24)}`, projectRef),
    fingerprintSourceSecret(secret(`sb_secret_${'x'.repeat(24)}`), projectRef));
  assert.equal(classifySourceSecret(`sb_secret_${'x'.repeat(24)}`,
    PRODUCTION_EPOCH.projectRef), 'modern_secret');
});

test('classifies a legacy JWT candidate separately', () => {
  assert.equal(classifySourceSecret(secret(`eyJ${'x'.repeat(40)}`), projectRef), 'legacy_service_role_candidate');
});

test('fails closed on project or key mismatch', () => {
  assert.throws(() => classifySourceSecret(secret(`sb_secret_${'x'.repeat(24)}`), 'izlkwggluhlhzlumtzes'),
    /SOURCE_PROJECT_MISMATCH/);
  assert.throws(() => classifySourceSecret(secret('invalid'), projectRef),
    /SOURCE_ELEVATED_KEY_FORMAT_UNRECOGNIZED/);
  assert.throws(() => classifySourceSecret(`sb_secret_${'x'.repeat(24)}`,
    'wztqqqashilusoppddxi'), /UNAPPROVED_SOURCE_PROJECT/);
});

test('production epoch identities are distinct, purpose named, and production pinned', () => {
  assert.equal(PRODUCTION_EPOCH.projectRef, 'izlkwggluhlhzlumtzes');
  assert.notEqual(PRODUCTION_EPOCH.captureKeyName, PRODUCTION_EPOCH.rollbackKeyName);
  assert.notEqual(PRODUCTION_EPOCH.captureSecretName, PRODUCTION_EPOCH.rollbackSecretName);
  for (const [key, value] of Object.entries(PRODUCTION_EPOCH)) {
    if (key === 'projectRef') continue;
    assert.match(value, /production/);
    assert.doesNotMatch(value, /rehearsal|staging/);
  }
});
