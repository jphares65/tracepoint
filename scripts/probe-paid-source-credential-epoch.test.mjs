import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertDistinctEpochKeys, rejectedCredential, rejectedStorageCredential } from './source-credential-epoch-core.mjs';

test('credential epoch requires three distinct modern keys', () => {
  const keys = ['a', 'b', 'c'].map(letter => `sb_secret_${letter.repeat(24)}`);
  assert.doesNotThrow(() => assertDistinctEpochKeys(keys));
  assert.throws(() => assertDistinctEpochKeys([keys[0], keys[0], keys[2]]), /EPOCH_KEYS_NOT_DISTINCT/);
  assert.throws(() => assertDistinctEpochKeys(['invalid', keys[1], keys[2]]), /MODERN_SECRET_REQUIRED/);
});

test('retired credential probe accepts only authorization denial', () => {
  assert.equal(rejectedCredential(401), true);
  assert.equal(rejectedCredential(403), true);
  assert.equal(rejectedCredential(500), false);
  assert.equal(rejectedCredential(200), false);
});

test('Storage HTTP 400 is accepted only for exact denied credential with a live same-request control', () => {
  assert.equal(rejectedStorageCredential(400, { code: 'AccessDenied', error: 'Unauthorized' }, 200), true);
  assert.equal(rejectedStorageCredential(400, { code: 'AccessDenied', error: 'Unauthorized' }, 400), false);
  assert.equal(rejectedStorageCredential(400, { code: 'NoSuchBucket', error: 'Bad Request' }, 200), false);
  assert.equal(rejectedStorageCredential(500, { code: 'AccessDenied', error: 'Unauthorized' }, 200), false);
  assert.equal(rejectedStorageCredential(401, null, 200), true);
});

test('paid epoch probe is exact-project and never prints credentials or rows', () => {
  const source = readFileSync(new URL('./probe-paid-source-credential-epoch.mjs', import.meta.url), 'utf8');
  assert.match(source, /reukdouvpshshvqnzsgw/);
  assert.match(source, /source-rehearsal-epoch-capture-20260927/);
  assert.match(source, /source-rehearsal-epoch-rollback-20260927/);
  assert.match(source, /id=eq\.00000000-0000-0000-0000-000000000000/);
  assert.match(source, /'PATCH', ABSENT_ROW_PATH/);
  assert.doesNotMatch(source, /'PATCH', ROW_PATH/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:oldKey|captureKey|rollbackKey|\.text)/);
});
