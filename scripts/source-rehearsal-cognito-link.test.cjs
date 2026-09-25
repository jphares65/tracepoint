const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prepareLinks } = require('./source-rehearsal-cognito-link.cjs');

function fixture() {
  const source = Array.from({ length: 96 }, (_, index) => ({
    id: randomUUID(), email: `person${index}@example.invalid`,
    confirmed_at: index === 2 ? null : '2026-01-01T00:00:00Z',
    banned_until: null,
  }));
  const memberships = source.map((row, index) => ({ user_id: row.id, is_active: index !== 1 }));
  const users = source.map((row, index) => ({
    Username: randomUUID(),
    Enabled: index !== 1,
    UserStatus: 'FORCE_CHANGE_PASSWORD',
    Attributes: [
      { Name: 'email', Value: row.email },
      { Name: 'email_verified', Value: index === 2 ? 'false' : 'true' },
      { Name: 'sub', Value: '' },
    ],
  }));
  for (const user of users) user.Attributes[2].Value = user.Username;
  users.push({ Username: 'fixture@example.invalid', Attributes: [{ Name: 'email', Value: 'fixture@example.invalid' }] });
  return { source, memberships, users };
}

test('exact 96 source identities plus one fixture produce unique stable links', () => {
  const value = fixture();
  const links = prepareLinks(value.source, value.users, value.memberships, '2026-02-01T00:00:00Z');
  assert.equal(links.length, 96);
  assert.equal(new Set(links.map(link => link.subject)).size, 96);
  assert.deepEqual(links.map(link => link.id), value.source.map(row => row.id));
});

test('missing, duplicate, or extra Cognito users fail closed', () => {
  const value = fixture();
  assert.throws(() => prepareLinks(value.source, value.users.slice(1), value.memberships, '2026-02-01T00:00:00Z'), /COGNITO_USER_COUNT_MISMATCH/);
  value.users[0].Attributes[0].Value = value.users[1].Attributes[0].Value;
  assert.throws(() => prepareLinks(value.source, value.users, value.memberships, '2026-02-01T00:00:00Z'), /COGNITO_EMAIL_DUPLICATE/);
});

test('inactive and unconfirmed source semantics must match Cognito', () => {
  const value = fixture();
  value.users[1].Enabled = true;
  assert.throws(() => prepareLinks(value.source, value.users, value.memberships, '2026-02-01T00:00:00Z'), /COGNITO_DISABLED_SEMANTICS_MISMATCH/);
  value.users[1].Enabled = false;
  value.users[2].Attributes[1].Value = 'true';
  assert.throws(() => prepareLinks(value.source, value.users, value.memberships, '2026-02-01T00:00:00Z'), /COGNITO_CONFIRMATION_MISMATCH/);
});

test('subject duplication or unreviewed username shape fails closed', () => {
  const value = fixture();
  value.users[1].Username = value.users[0].Username;
  value.users[1].Attributes[2].Value = value.users[0].Attributes[2].Value;
  assert.throws(() => prepareLinks(value.source, value.users, value.memberships, '2026-02-01T00:00:00Z'), /COGNITO_SUB_DUPLICATE/);
  value.users[1].Username = randomUUID();
  value.users[1].Attributes[2].Value = randomUUID();
  assert.throws(() => prepareLinks(value.source, value.users, value.memberships, '2026-02-01T00:00:00Z'), /COGNITO_USERNAME_SUB_MISMATCH/);
});
