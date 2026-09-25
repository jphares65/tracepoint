// Fixed rehearsal-only invite retry contract. No caller-supplied SQL or target.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const host = 'tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const department = 'd01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0';
const actor = 'c38e1b61-551b-4519-ae3e-6b0f76a1ac01';
const recipient = 'jphares@tracepointhq.com';
const expectedHash = 'bf289e434a09658aad33b3d34b50c4e1602010636cf9594cafdccbf2ff8c1aa5';
const migrationPath = '/app/database/aws/027_cognito_invite_retry_claim.sql';
const mode = process.argv[2];
if (mode !== 'inspect' && mode !== 'apply') throw Error('FIXED_REHEARSAL_INVITE_RETRY_MODE_REQUIRED');

const secret = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON ?? 'null');
if (secret?.host !== host || secret?.dbname !== 'tracepoint' || secret?.port !== 5432 ||
    secret?.username !== 'tracepoint_migrator' || typeof secret?.password !== 'string' ||
    secret.password.length < 20) throw Error('REHEARSAL_TARGET_PIN_MISMATCH');
const ca = readFileSync('/app/rds-ca.pem', 'utf8');
if (!ca.includes('BEGIN CERTIFICATE')) throw Error('RDS_CA_UNAVAILABLE');
const raw = readFileSync(migrationPath, 'utf8').replaceAll('\r\n', '\n');
const actualHash = createHash('sha256').update(raw).digest('hex');
if (actualHash !== expectedHash) throw Error('REVIEWED_MIGRATION_HASH_MISMATCH');
const sql = raw.replace(/^begin;\s*/i, '').replace(/\s*commit;\s*$/i, '');
if (sql === raw) throw Error('MIGRATION_TRANSACTION_ENVELOPE_MISSING');

const client = new pg.Client({
  host, port: 5432, database: 'tracepoint', user: secret.username, password: secret.password,
  ssl: { ca, rejectUnauthorized: true, servername: host },
  connectionTimeoutMillis: 10_000, statement_timeout: 20_000,
  application_name: 'tracepoint-phase3c-invite-retry-schema',
});

async function main() {
  let phase = 'connect';
  let started = false;
  try {
    await client.connect();
    phase = 'target-attestation';
    const identity = (await client.query(`select current_database() as db,current_user as role,
      (select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls`)).rows[0];
    if (identity?.db !== 'tracepoint' || identity?.role !== 'tracepoint_migrator' ||
        identity?.tls !== true) throw Error('REHEARSAL_TARGET_IDENTITY_MISMATCH');

    phase = 'pending-identity-preflight';
    const counts = (await client.query(`select
      (select count(*)::int from public.profiles where lower(btrim(email))=$1) as profiles,
      (select count(*)::int from auth.users where lower(btrim(email))=$1) as auth_users,
      (select count(*)::int from public.department_memberships m join public.profiles p on p.id=m.user_id
        where lower(btrim(p.email))=$1) as memberships,
      (select count(*)::int from public.authentication_identity_links l join public.profiles p on p.id=l.tracepoint_user_id
        where lower(btrim(p.email))=$1) as identity_links,
      (select count(*)::int from public.user_activation_tokens t join public.profiles p on p.id=t.user_id
        where lower(btrim(p.email))=$1) as activation_tokens,
      (select count(*)::int from public.authentication_identity_events e join public.profiles p on p.id=e.tracepoint_user_id
        where lower(btrim(p.email))=$1) as identity_events,
      (select count(*)::int from public.authentication_lifecycle_operations o join public.profiles p on p.id=o.tracepoint_user_id
        where lower(btrim(p.email))=$1) as operations`, [recipient])).rows[0];
    const pending = (await client.query(`select p.id as user_id,m.department_id,m.activation_status,m.is_active,
      m.deactivated_at,o.id as operation_id,o.operation_kind,o.state,o.safe_error_code,
      o.actor_user_id,o.provider_username,o.provider_subject,o.attempts,
      (select array_agg(r.role_code order by r.role_code) from public.department_membership_roles r
        where r.user_id=p.id and r.department_id=m.department_id) as roles,
      (select count(*)::int from public.department_group_members g where g.user_id=p.id) as groups,
      a.raw_user_meta_data->>'identity_provider' as identity_provider
      from public.profiles p join auth.users a on a.id=p.id
      join public.department_memberships m on m.user_id=p.id
      join public.authentication_lifecycle_operations o on o.tracepoint_user_id=p.id
      where lower(btrim(p.email))=$1`, [recipient])).rows;
    if (counts.profiles !== 1 || counts.auth_users !== 1 || counts.memberships !== 1 ||
        counts.identity_links !== 0 || counts.activation_tokens !== 0 || counts.identity_events !== 0 ||
        counts.operations !== 1 || pending.length !== 1 ||
        pending[0].department_id !== department || pending[0].activation_status !== 'pending_activation' ||
        pending[0].is_active !== true || pending[0].deactivated_at !== null ||
        pending[0].operation_kind !== 'invite' || pending[0].state !== 'compensation_required' ||
        pending[0].safe_error_code !== 'provider_create_failed' || pending[0].actor_user_id !== actor ||
        pending[0].provider_subject !== null || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(pending[0].provider_username ?? '') ||
        pending[0].attempts >= 100 || pending[0].roles?.length !== 1 || pending[0].roles[0] !== 'officer' ||
        pending[0].groups !== 0 || pending[0].identity_provider !== 'cognito')
      throw Error('INVITE_RETRY_PREFLIGHT_MISMATCH');

    if (mode === 'apply') {
      phase = 'fixed-schema-migration';
      await client.query('begin');
      started = true;
      await client.query("set local lock_timeout='5s'");
      await client.query(sql);
      const signatures = [
        'tracepoint_auth.inspect_cognito_invite_retry(uuid,text,text,text,text,text,text,text[],uuid[])',
        'tracepoint_auth.claim_cognito_invite_retry(uuid,text,text,text,text,text,text,text[],uuid[],uuid)',
      ];
      for (const signature of signatures) {
        const rights = (await client.query(`select
          has_function_privilege('authenticated',$1,'EXECUTE') as authenticated_execute,
          has_function_privilege('anon',$1,'EXECUTE') as anon_execute,
          has_function_privilege('service_role',$1,'EXECUTE') as service_execute`, [signature])).rows[0];
        if (!rights.authenticated_execute || rights.anon_execute || rights.service_execute)
          throw Error('INVITE_RETRY_FUNCTION_PRIVILEGE_MISMATCH');
      }
      await client.query('commit');
      started = false;
    }
    console.log(JSON.stringify({ status: 'PASS', phase, mode, target: host, database: identity.db,
      tlsVerified: true, department, userId: pending[0].user_id, operationId: pending[0].operation_id,
      role: 'officer', activationStatus: 'pending_activation', identityLinks: 0,
      cognitoSubjectLinked: false, counts, migrationSha256: actualHash }));
  } catch (error) {
    if (started) await client.query('rollback').catch(() => {});
    console.error(JSON.stringify({ status: 'FAIL', phase, sqlState: error?.code ?? null,
      reason: typeof error?.message === 'string' && /^[A-Z_]+$/.test(error.message)
        ? error.message : 'DATABASE_SCHEMA_ERROR' }));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
main().catch(() => { process.exitCode = 1; });
