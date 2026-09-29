// One-shot production cutover identity stage. Runs only inside the isolated ECS task.
// Never emits identity rows, email addresses, subjects, or temporary passwords.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const {
  CognitoIdentityProviderClient, AdminGetUserCommand, AdminCreateUserCommand,
  AdminDisableUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const pg = require('pg');

const ACCOUNT = '193644343389';
const POOL = 'us-east-1_diFmWDMe9';
const ISSUER = `https://cognito-idp.us-east-1.amazonaws.com/${POOL}`;
const HOST = 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normalizeEmail = value => String(value ?? '').trim().toLowerCase();
const attributes = user => new Map((user.UserAttributes ?? user.Attributes ?? []).map(item => [item.Name, item.Value]));

function validateSource(users, profiles, memberships, platformAdmins) {
  assert.equal(users.length, 96, 'SOURCE_IDENTITY_COUNT_MISMATCH');
  assert.equal(profiles.length, 96, 'SOURCE_PROFILE_COUNT_MISMATCH');
  assert.equal(memberships.length, 95, 'SOURCE_MEMBERSHIP_COUNT_MISMATCH');
  const ids = new Set(users.map(row => String(row.id)));
  const emails = new Set(users.map(row => normalizeEmail(row.email)));
  assert.equal(ids.size, 96, 'SOURCE_ID_DUPLICATE');
  assert.equal(emails.size, 96, 'SOURCE_EMAIL_DUPLICATE');
  assert.ok(users.every(row => UUID.test(String(row.id)) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(row.email))), 'SOURCE_IDENTITY_INVALID');
  const profileById = new Map(profiles.map(row => [String(row.id), row]));
  assert.equal(profileById.size, 96, 'SOURCE_PROFILE_DUPLICATE');
  assert.ok(users.every(row => normalizeEmail(profileById.get(String(row.id))?.email) === normalizeEmail(row.email)), 'SOURCE_PROFILE_MISMATCH');
  assert.ok(memberships.every(row => ids.has(String(row.user_id))), 'SOURCE_MEMBERSHIP_ORPHAN');
  const membershipKeys = new Set(memberships.map(row => `${row.user_id}:${row.department_id}`));
  assert.equal(membershipKeys.size, 95, 'SOURCE_MEMBERSHIP_DUPLICATE');
  const memberIds = new Set(memberships.map(row => String(row.user_id)));
  const adminIds = new Set(platformAdmins.map(row => String(row.user_id)));
  assert.ok([...ids].every(id => memberIds.has(id) || adminIds.has(id)), 'SOURCE_IDENTITY_UNOWNED');
  return { ids, memberIds };
}

function expectedStatus(user, memberships, capturedAt) {
  const userMemberships = memberships.filter(row => String(row.user_id) === String(user.id));
  const disabled = Boolean(user.banned_until && Date.parse(user.banned_until) > Date.parse(capturedAt)) ||
    (userMemberships.length > 0 && userMemberships.every(row => row.is_active !== true));
  return { disabled, confirmed: Boolean(user.confirmed_at || user.email_confirmed_at) };
}

function validateCognito(user, source, expectation) {
  const attrs = attributes(user);
  assert.equal(normalizeEmail(attrs.get('email')), normalizeEmail(source.email), 'COGNITO_EMAIL_MISMATCH');
  assert.equal(attrs.get('email_verified'), expectation.confirmed ? 'true' : 'false', 'COGNITO_CONFIRMATION_MISMATCH');
  assert.equal(user.Enabled === false, expectation.disabled, 'COGNITO_DISABLED_MISMATCH');
  assert.equal(user.UserStatus, 'FORCE_CHANGE_PASSWORD', 'COGNITO_STATUS_MISMATCH');
  const subject = attrs.get('sub');
  assert.ok(UUID.test(String(subject)), 'COGNITO_SUBJECT_INVALID');
  assert.equal(user.Username, subject, 'COGNITO_USERNAME_SUBJECT_MISMATCH');
  return { id: String(source.id), subject, username: user.Username };
}

async function main() {
  let phase = 'attestation';
  let db;
  const cognito = new CognitoIdentityProviderClient({ region: 'us-east-1', maxAttempts: 2 });
  try {
    const mode = process.env.TRACEPOINT_FINAL_COGNITO_STAGE;
    assert.ok(mode === 'on' || mode === 'preflight', 'STAGE_FLAG_MISSING');
    assert.equal(process.env.TRACEPOINT_AWS_ACCOUNT_ID, ACCOUNT, 'ACCOUNT_PIN_MISMATCH');
    assert.equal(process.env.TRACEPOINT_COGNITO_USER_POOL_ID, POOL, 'POOL_PIN_MISMATCH');
    const secret = JSON.parse(process.env.TARGET_DATABASE_SECRET_JSON ?? 'null');
    // The existing migrator credential retains its original hostname. As in
    // the final importer, connect only to the separately pinned final target.
    assert.ok([HOST, 'tracepoint-production.c8r4sgs089tu.us-east-1.rds.amazonaws.com'].includes(secret?.host),
      'RDS_SECRET_HOST_MISMATCH');
    assert.equal(secret?.dbname, 'tracepoint', 'RDS_DATABASE_MISMATCH');
    assert.equal(Number(secret?.port), 5432, 'RDS_PORT_MISMATCH');
    assert.equal(secret?.username, 'tracepoint_migrator', 'RDS_USER_MISMATCH');
    assert.ok(typeof secret?.password === 'string' && secret.password.length >= 20, 'RDS_CREDENTIAL_MISSING');
    const ca = readFileSync('/app/rds-ca.pem', 'utf8');
    db = new pg.Client({ host: HOST, port: 5432, database: 'tracepoint', user: secret.username,
      password: secret.password, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10000,
      statement_timeout: 30000, application_name: 'tracepoint-production-final-cognito-stage-link' });
    await db.connect();
    const identity = (await db.query("select current_database() as database,current_user as role,(select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls")).rows[0];
    assert.deepEqual(identity, { database: 'tracepoint', role: 'tracepoint_migrator', tls: true }, 'RDS_IDENTITY_MISMATCH');
    const lineage = await db.query('select count(*)::int as count from tracepoint_migrations.applied_migrations');
    assert.equal(lineage.rows[0].count, 99, 'RDS_SCHEMA_LINEAGE_MISMATCH');
    phase = 'source-users';
    const usersResult = await db.query('select to_jsonb(u) as row from auth.users u order by u.id');
    phase = 'source-profiles';
    const profilesResult = await db.query('select to_jsonb(p) as row from public.profiles p order by p.id');
    phase = 'source-memberships';
    const membershipsResult = await db.query('select to_jsonb(m) as row from public.department_memberships m order by m.user_id');
    phase = 'source-platform-admins';
    const adminsResult = await db.query('select to_jsonb(a) as row from public.platform_admins a');
    phase = 'source-links';
    const linksResult = await db.query("select issuer,subject,tracepoint_user_id,state,provider_username from public.authentication_identity_links where provider='cognito'");
    const source = usersResult.rows.map(result => result.row);
    const memberships = membershipsResult.rows.map(result => result.row);
    validateSource(source, profilesResult.rows.map(result => result.row), memberships,
      adminsResult.rows.map(result => result.row));
    if (mode === 'preflight') assert.equal(linksResult.rowCount, 0, 'PREEXISTING_COGNITO_LINKS');
    const pendingById = new Map(linksResult.rows.map(link => [String(link.tracepoint_user_id), link]));
    assert.equal(pendingById.size, linksResult.rowCount, 'COGNITO_LINK_DUPLICATE');
    assert.ok(linksResult.rows.every(link => link.issuer === ISSUER && link.state === 'pending' &&
      source.some(user => String(user.id) === String(link.tracepoint_user_id)) &&
      UUID.test(String(link.subject)) && link.provider_username === link.subject), 'COGNITO_LINK_CONFLICT');
    phase = 'cognito-preflight';
    // No source email may already exist in the exact pool on the initial run.
    // A resumed task may see a previously created FORCE_CHANGE_PASSWORD user;
    // it is accepted only after every source attribute and status is revalidated.
    const prepared = [];
    for (const user of source) {
      const email = normalizeEmail(user.email);
      const expectation = expectedStatus(user, memberships, new Date());
      const pending = pendingById.get(String(user.id));
      let existing;
      try { existing = await cognito.send(new AdminGetUserCommand({ UserPoolId: POOL, Username: pending?.provider_username ?? email })); }
      catch (error) { if (error?.name !== 'UserNotFoundException') throw error; }
      if (pending) {
        assert.ok(existing, 'PENDING_COGNITO_USER_MISSING');
        const verified = validateCognito(existing, user, expectation);
        assert.equal(verified.subject, pending.subject, 'PENDING_COGNITO_SUBJECT_MISMATCH');
      } else assert.ok(!existing, 'UNLINKED_COGNITO_IDENTITY');
      prepared.push({ source: user, email, expectation, existing, pending });
    }
    if (mode === 'preflight') {
      assert.equal(prepared.filter(item => item.existing).length, 0, 'SOURCE_EMAIL_ALREADY_IN_POOL');
      console.log(JSON.stringify({ status: 'FINAL_COGNITO_PREFLIGHT_PASS', sourceIdentities: 96,
        existingSourcePoolUsers: 0, currentRdsLinks: 0, mutations: 0, credentialsLogged: false }));
      return;
    }
    phase = 'cognito-create';
    await db.query("set tracepoint.migration_mode='on'");
    const links = [];
    let created = 0;
    let disabled = 0;
    for (const item of prepared) {
      let username = item.pending?.provider_username;
      if (!item.existing) {
        const temporary = crypto.randomBytes(30).toString('base64url') + 'Aa1!';
        const createdUser = (await cognito.send(new AdminCreateUserCommand({ UserPoolId: POOL, Username: item.email,
          TemporaryPassword: temporary, MessageAction: 'SUPPRESS', ForceAliasCreation: false,
          UserAttributes: [{ Name: 'email', Value: item.email },
            { Name: 'email_verified', Value: item.expectation.confirmed ? 'true' : 'false' }] }))).User;
        username = createdUser?.Username;
        assert.ok(UUID.test(String(username)), 'CREATED_COGNITO_USERNAME_INVALID');
        created++;
        if (item.expectation.disabled) {
          await cognito.send(new AdminDisableUserCommand({ UserPoolId: POOL, Username: item.email }));
          disabled++;
        }
      }
      const actual = await cognito.send(new AdminGetUserCommand({ UserPoolId: POOL, Username: username }));
      const link = validateCognito(actual, item.source, item.expectation);
      if (!item.pending) {
        const stored = await db.query("insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state,provider_username) values('cognito',$1,$2,$3,'pending',$4)",
          [ISSUER, link.subject, link.id, link.username]);
        assert.equal(stored.rowCount, 1, 'PENDING_LINK_INSERT_FAILED');
      }
      links.push(link);
    }
    assert.equal(links.length, 96, 'COGNITO_COHORT_COUNT_MISMATCH');
    assert.equal(new Set(links.map(link => link.subject)).size, 96, 'COGNITO_SUBJECT_DUPLICATE');
    phase = 'atomic-link';
    await db.query('begin');
    try {
      await db.query("set local lock_timeout='5s'");
      await db.query("set local idle_in_transaction_session_timeout='60s'");
      await db.query("set local tracepoint.migration_mode='on'");
      const before = await db.query("select count(*)::int as count from public.authentication_identity_links where provider='cognito'");
      assert.equal(before.rows[0].count, 96, 'PENDING_LINK_COUNT_MISMATCH');
      const promoted = await db.query("update public.authentication_identity_links set state='active',updated_at=now() where provider='cognito' and issuer=$1 and state='pending' and tracepoint_user_id=any($2::uuid[]) returning tracepoint_user_id",
        [ISSUER, links.map(link => link.id)]);
      assert.equal(promoted.rowCount, 96, 'COGNITO_LINK_PROMOTION_MISMATCH');
      const after = await db.query("select subject,tracepoint_user_id,state,provider_username from public.authentication_identity_links where provider='cognito' and issuer=$1", [ISSUER]);
      assert.equal(after.rowCount, 96, 'COGNITO_LINK_COUNT_MISMATCH');
      const byId = new Map(after.rows.map(row => [String(row.tracepoint_user_id), row]));
      assert.ok(links.every(link => byId.get(link.id)?.subject === link.subject && byId.get(link.id)?.state === 'active' &&
        byId.get(link.id)?.provider_username === link.username), 'COGNITO_LINK_PARITY_MISMATCH');
      await db.query('commit');
    } catch (error) { await db.query('rollback').catch(() => {}); throw error; }
    console.log(JSON.stringify({ status: 'FINAL_COGNITO_COHORT_LINKED', sourceIdentities: 96,
      created, disabled, linked: 96, unmatched: 0, duplicateSubjects: 0,
      invitationEmailsSent: 0, credentialsLogged: false, sourceMutation: false }));
  } catch (error) {
    const code = String(error?.message ?? '').split(/\r?\n/, 1)[0];
    console.error(JSON.stringify({ status: 'FINAL_COGNITO_COHORT_FAILED', phase,
      code: /^[A-Z_]+$/.test(code) ? code : 'FAIL_CLOSED', errorClass: String(error?.code ?? error?.name ?? 'Error') }));
    process.exitCode = 1;
  } finally { await db?.end().catch(() => {}); cognito.destroy(); }
}
if (['on', 'preflight'].includes(process.env.TRACEPOINT_FINAL_COGNITO_STAGE)) main();
module.exports = { validateSource, expectedStatus, validateCognito };
