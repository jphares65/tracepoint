// One-shot, AWS-local identity-link rehearsal. Never print source or Cognito identity values.
// It never creates Cognito users, sends mail, or reads live Supabase.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { CognitoIdentityProviderClient, DescribeUserPoolCommand, paginateListUsers } = require('@aws-sdk/client-cognito-identity-provider');
const pg = require('pg');

const ACCOUNT = '193644343389';
const BUCKET = `tracepoint-production-private-${ACCOUNT}`;
const KEY = 'migration/source/4272874f-bae4-49f4-a0b4-67a39cec2874/initial-canonical.json';
const VERSION = 'E2D8RfEoImElsrFBqDDTE4Bqu6ANK6Xa';
const BYTE_SHA = '010f0f403ee08c9ed894ee68473ef9d19f82b56ba05bfc1fa8204fda83a4bc20';
const MASTER_SHA = '8b01ea2a57a650b10d126160c5d171fecf1e98f1e07a9fa720e97e600d8d6d57';
const POOL = 'us-east-1_wZwXHpznS';
const ISSUER = `https://cognito-idp.us-east-1.amazonaws.com/${POOL}`;
const HOST = 'tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailOf = value => String(value ?? '').trim().toLowerCase();
const attrsOf = user => new Map((user.Attributes ?? []).map(item => [item.Name, item.Value]));

function prepareLinks(source, users, memberships, capturedAtUtc) {
  assert.equal(users.length, 97, 'COGNITO_USER_COUNT_MISMATCH');
  const sourceEmails = source.map(row => emailOf(row.email));
  const byEmail = new Map(users.map(user => [emailOf(attrsOf(user).get('email')), user]));
  assert.equal(byEmail.size, 97, 'COGNITO_EMAIL_DUPLICATE');
  assert.ok(sourceEmails.every(email => byEmail.has(email)), 'COGNITO_SOURCE_SET_MISMATCH');
  const sourceEmailSet = new Set(sourceEmails);
  assert.equal(users.filter(user => !sourceEmailSet.has(emailOf(attrsOf(user).get('email')))).length, 1, 'COGNITO_EXTRA_USER_MISMATCH');
  const inactiveIds = new Set(memberships.filter(row => row.is_active !== true).map(row => String(row.user_id)));
  const activeIds = new Set(memberships.filter(row => row.is_active === true).map(row => String(row.user_id)));
  const links = source.map(identity => {
    const user = byEmail.get(emailOf(identity.email));
    const attrs = attrsOf(user);
    const confirmed = Boolean(identity.confirmed_at || identity.email_confirmed_at);
    const disabled = Boolean(identity.banned_until && Date.parse(identity.banned_until) > Date.parse(capturedAtUtc)) ||
      (inactiveIds.has(String(identity.id)) && !activeIds.has(String(identity.id)));
    assert.equal(user.Enabled === false, disabled, 'COGNITO_DISABLED_SEMANTICS_MISMATCH');
    assert.equal(attrs.get('email_verified'), confirmed ? 'true' : 'false', 'COGNITO_CONFIRMATION_MISMATCH');
    assert.equal(user.UserStatus, 'FORCE_CHANGE_PASSWORD', 'COGNITO_STATUS_MISMATCH');
    assert.ok(uuid.test(String(attrs.get('sub') ?? '')), 'COGNITO_SUB_INVALID');
    // This pool uses email aliases; Cognito's immutable Username is its UUID subject.
    assert.equal(String(user.Username), String(attrs.get('sub')), 'COGNITO_USERNAME_SUB_MISMATCH');
    return { id: String(identity.id), email: emailOf(identity.email), subject: attrs.get('sub'), username: user.Username };
  });
  assert.equal(new Set(links.map(link => link.subject)).size, 96, 'COGNITO_SUB_DUPLICATE');
  return links;
}

async function main() {
  let phase = 'artifact';
  const s3 = new S3Client({ region: 'us-east-1', maxAttempts: 1 });
  const cognito = new CognitoIdentityProviderClient({ region: 'us-east-1', maxAttempts: 2 });
  let db;
  try {
    const ledger = await import('/app/scripts/supabase-rest-ledger-core.mjs');
    const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: KEY, VersionId: VERSION, ExpectedBucketOwner: ACCOUNT }));
    assert.equal(object.VersionId, VERSION, 'ARTIFACT_VERSION_MISMATCH');
    const bytes = await object.Body.transformToByteArray();
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), BYTE_SHA, 'ARTIFACT_BYTE_HASH_MISMATCH');
    const artifact = JSON.parse(Buffer.from(bytes).toString('utf8'));
    const { masterSha256, ...body } = artifact;
    assert.equal(masterSha256, MASTER_SHA, 'ARTIFACT_MASTER_PIN_MISMATCH');
    assert.equal(ledger.sha256(body), MASTER_SHA, 'ARTIFACT_CONTENT_HASH_MISMATCH');
    assert.equal(artifact.identities.count, 96, 'SOURCE_IDENTITY_COUNT_MISMATCH');
    assert.equal(ledger.sha256(artifact.identities.rows), artifact.identities.canonicalDataSha256, 'SOURCE_IDENTITY_HASH_MISMATCH');
    const source = artifact.identities.rows;
    const sourceIds = source.map(row => String(row.id));
    const sourceEmails = source.map(row => emailOf(row.email));
    assert.equal(new Set(sourceIds).size, 96, 'SOURCE_ID_DUPLICATE');
    assert.equal(new Set(sourceEmails).size, 96, 'SOURCE_EMAIL_DUPLICATE');
    assert.ok(sourceIds.every(id => uuid.test(id)) && sourceEmails.every(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)), 'SOURCE_IDENTITY_INVALID');

    phase = 'cognito';
    const pool = (await cognito.send(new DescribeUserPoolCommand({ UserPoolId: POOL }))).UserPool;
    assert.equal(pool?.Arn, `arn:aws:cognito-idp:us-east-1:${ACCOUNT}:userpool/${POOL}`, 'COGNITO_POOL_IDENTITY_MISMATCH');
    assert.equal(pool?.MfaConfiguration, 'ON', 'COGNITO_MFA_MISMATCH');
    const users = [];
    for await (const page of paginateListUsers({ client: cognito, pageSize: 60 }, { UserPoolId: POOL })) users.push(...(page.Users ?? []));
    const links = prepareLinks(source, users, artifact.rows.department_memberships, artifact.capturedAtUtc);

    phase = 'database-attestation';
    const secret = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON ?? 'null');
    assert.equal(secret?.host, HOST, 'RDS_HOST_MISMATCH');
    assert.equal(secret?.dbname, 'tracepoint', 'RDS_DATABASE_MISMATCH');
    assert.equal(secret?.port, 5432, 'RDS_PORT_MISMATCH');
    assert.equal(secret?.username, 'tracepoint_migrator', 'RDS_USER_MISMATCH');
    assert.ok(typeof secret?.password === 'string' && secret.password.length >= 20, 'RDS_CREDENTIAL_MISSING');
    const ca = readFileSync('/app/rds-ca.pem', 'utf8');
    assert.ok(ca.includes('BEGIN CERTIFICATE'), 'RDS_CA_MISSING');
    db = new pg.Client({ host: HOST, port: 5432, database: 'tracepoint', user: secret.username, password: secret.password,
      ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10000, statement_timeout: 30000,
      application_name: 'tracepoint-source-rehearsal-cognito-link' });
    await db.connect();
    const identity = (await db.query("select current_database() as database,current_user as role,(select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls")).rows[0];
    assert.deepEqual(identity, { database: 'tracepoint', role: 'tracepoint_migrator', tls: true }, 'RDS_IDENTITY_MISMATCH');

    phase = 'relational-comparison';
    const profiles = await db.query('select id,email from public.profiles where id=any($1::uuid[])', [sourceIds]);
    const anchors = await db.query('select id,email from auth.users where id=any($1::uuid[])', [sourceIds]);
    assert.equal(profiles.rowCount, 96, 'RDS_PROFILE_COUNT_MISMATCH');
    assert.equal(anchors.rowCount, 96, 'RDS_ANCHOR_COUNT_MISMATCH');
    const profileEmail = new Map(profiles.rows.map(row => [String(row.id), emailOf(row.email)]));
    const anchorEmail = new Map(anchors.rows.map(row => [String(row.id), emailOf(row.email)]));
    assert.ok(links.every(link => profileEmail.get(link.id) === link.email && anchorEmail.get(link.id) === link.email), 'RDS_ID_EMAIL_MISMATCH');
    const existing = await db.query("select provider,issuer,subject,tracepoint_user_id,state from public.authentication_identity_links where provider='cognito'");
    assert.equal(existing.rowCount, 1, 'RDS_PREEXISTING_LINK_COUNT_MISMATCH');
    assert.equal(existing.rows[0].issuer, ISSUER, 'RDS_PREEXISTING_ISSUER_MISMATCH');
    assert.ok(!sourceIds.includes(String(existing.rows[0].tracepoint_user_id)), 'RDS_SOURCE_LINK_ALREADY_PRESENT');
    assert.equal(existing.rows[0].state, 'active', 'RDS_FIXTURE_LINK_STATE_MISMATCH');

    phase = 'atomic-link-insert';
    await db.query('begin');
    try {
      await db.query("set local lock_timeout='5s'");
      await db.query("set local idle_in_transaction_session_timeout='60s'");
      await db.query("set local tracepoint.migration_mode='on'");
      const before = await db.query("select count(*)::int as count from public.authentication_identity_links where provider='cognito'");
      assert.equal(before.rows[0].count, 1, 'RDS_CONCURRENT_LINK_CHANGE');
      for (const link of links) {
        const result = await db.query("insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state,provider_username) values('cognito',$1,$2,$3,'active',$4)",
          [ISSUER, link.subject, link.id, link.username]);
        assert.equal(result.rowCount, 1, 'RDS_LINK_INSERT_FAILED');
      }
      const after = await db.query("select subject,tracepoint_user_id,state,provider_username from public.authentication_identity_links where provider='cognito' and issuer=$1", [ISSUER]);
      assert.equal(after.rowCount, 97, 'RDS_LINK_COUNT_MISMATCH');
      const byId = new Map(after.rows.map(row => [String(row.tracepoint_user_id), row]));
      assert.ok(links.every(link => byId.get(link.id)?.subject === link.subject && byId.get(link.id)?.state === 'active' &&
        byId.get(link.id)?.provider_username === link.username), 'RDS_LINK_PARITY_MISMATCH');
      await db.query('commit');
    } catch (error) { await db.query('rollback').catch(() => {}); throw error; }
    console.log(JSON.stringify({ status: 'REHEARSAL_IDENTITY_LINK_PASS', sourceIdentities: 96, inserted: 96,
      totalRehearsalLinks: 97, unmatched: 0, duplicateSubjects: 0, credentialsLogged: false,
      productionCognitoTouched: false, sourceMutation: false }));
  } catch (error) {
    const safeCode = String(error?.message ?? '').split(/\r?\n/, 1)[0];
    console.error(JSON.stringify({ status: 'REHEARSAL_IDENTITY_LINK_FAILED', phase,
      code: /^[A-Z_]+$/.test(safeCode) ? safeCode : 'FAIL_CLOSED',
      errorClass: String(error?.code ?? error?.name ?? 'Error') }));
    process.exitCode = 1;
  } finally { await db?.end().catch(() => {}); s3.destroy(); cognito.destroy(); }
}
if (process.env.TRACEPOINT_REHEARSAL_LINK_RUN === 'on') main();
module.exports = { prepareLinks };
