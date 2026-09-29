const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSource, expectedStatus, validateCognito } = require('./production-final-cognito-stage-link.cjs');

const ids = Array.from({ length: 96 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const users = ids.map((id, index) => ({ id, email: `synthetic-${index}@example.invalid` }));
const profiles = users.map(({ id, email }) => ({ id, email }));
const memberships = ids.slice(0, 95).map(user_id => ({ user_id,
  department_id: '11111111-1111-4111-8111-111111111111', is_active: true }));
const admins = [{ user_id: ids[95] }];

test('requires exactly reconciled IDs, emails, membership pairs and exceptional platform admin', () => {
  assert.equal(validateSource(users, profiles, memberships, admins).ids.size, 96);
  assert.throws(() => validateSource(users, profiles, memberships, []), /SOURCE_IDENTITY_UNOWNED/);
  assert.throws(() => validateSource(users, profiles, [...memberships.slice(0, 94), memberships[0]], admins), /SOURCE_MEMBERSHIP_DUPLICATE/);
  assert.throws(() => validateSource(users, [{ ...profiles[0], email: 'wrong@example.invalid' }, ...profiles.slice(1)], memberships, admins), /SOURCE_PROFILE_MISMATCH/);
});

test('preserves confirmed, banned and inactive-only semantics', () => {
  const now = new Date('2026-09-29T02:00:00Z');
  assert.deepEqual(expectedStatus({ id: ids[0], confirmed_at: now.toISOString() }, memberships, now),
    { disabled: false, confirmed: true });
  assert.deepEqual(expectedStatus({ id: ids[0], banned_until: '2026-10-01T00:00:00Z' }, memberships, now),
    { disabled: true, confirmed: false });
  assert.deepEqual(expectedStatus({ id: ids[0] }, [{ ...memberships[0], is_active: false }], now),
    { disabled: true, confirmed: false });
});

test('fails closed on Cognito subject, confirmation, status and disabled mismatch', () => {
  const source = users[0];
  const subject = '22222222-2222-4222-8222-222222222222';
  const user = { Username: subject, Enabled: true, UserStatus: 'FORCE_CHANGE_PASSWORD',
    UserAttributes: [{ Name: 'sub', Value: subject }, { Name: 'email', Value: source.email },
      { Name: 'email_verified', Value: 'true' }] };
  assert.equal(validateCognito(user, source, { disabled: false, confirmed: true }).subject, subject);
  assert.throws(() => validateCognito(user, source, { disabled: true, confirmed: true }), /COGNITO_DISABLED_MISMATCH/);
  assert.throws(() => validateCognito(user, source, { disabled: false, confirmed: false }), /COGNITO_CONFIRMATION_MISMATCH/);
  assert.throws(() => validateCognito({ ...user, UserStatus: 'CONFIRMED' }, source, { disabled: false, confirmed: true }), /COGNITO_STATUS_MISMATCH/);
  assert.throws(() => validateCognito({ ...user, Username: 'not-sub' }, source, { disabled: false, confirmed: true }), /COGNITO_USERNAME_SUBJECT_MISMATCH/);
});
