import assert from 'node:assert/strict';
import test from 'node:test';
import { isRehearsalCognitoSubject } from './phase3c-rehearsal-subject.mjs';

test('accepts Cognito UUID-shaped subjects without requiring a UUID version or variant', () => {
  assert.equal(isRehearsalCognitoSubject('d46814c8-a041-7004-17f7-4ce5c07a72e0'), true);
  assert.equal(isRehearsalCognitoSubject('742824e8-60d1-7081-93a3-722b79de50c6'), true);
});

test('rejects missing, malformed, or injected subjects before any database initialization', () => {
  for (const value of [undefined, '', 'd46814c8-a041-7004-17f7-4ce5c07a72e0;select 1',
    'd46814c8a041700417f74ce5c07a72e0', 'not-a-subject']) {
    assert.equal(isRehearsalCognitoSubject(value), false);
  }
});
