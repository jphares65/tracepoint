import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feedbackAuthorities, resolveFeedbackAuthority } from './ses-feedback-authority';

for (const mode of ['old', 'rehearsal', 'final'] as const) {
  test(`${mode} feedback authority requires its one secret and host`, () => {
    const value = feedbackAuthorities[mode];
    assert.deepEqual(resolveFeedbackAuthority(mode, value.secretArn, value.host), value);
    for (const other of ['old', 'rehearsal', 'final'] as const) {
      if (other === mode) continue;
      assert.throws(() => resolveFeedbackAuthority(mode, feedbackAuthorities[other].secretArn, value.host));
      assert.throws(() => resolveFeedbackAuthority(mode, value.secretArn, feedbackAuthorities[other].host));
    }
  });
}

test('missing or unknown feedback mode fails closed', () => {
  const value = feedbackAuthorities.final;
  assert.throws(() => resolveFeedbackAuthority(undefined, value.secretArn, value.host));
  assert.throws(() => resolveFeedbackAuthority('latest', value.secretArn, value.host));
});
