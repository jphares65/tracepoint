// One-shot Phase 3C fixture. This is not an importer and accepts no SQL input.
// The fixed synthetic user can be removed with the cleanup mode after smoke testing.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { isRehearsalCognitoSubject } from './phase3c-rehearsal-subject.mjs';

const targetHost = 'tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const userId = 'c38e1b61-551b-4519-ae3e-6b0f76a1ac01';
const email = 'jphares+rehearsal@tracepointhq.com';
const poolId = process.env.TRACEPOINT_COGNITO_USER_POOL_ID ?? '';
if (!/^us-east-1_[A-Za-z0-9]+$/.test(poolId) || poolId === 'us-east-1_diFmWDMe9') throw Error('Dedicated rehearsal Cognito pool is required.');
const issuer = `https://cognito-idp.us-east-1.amazonaws.com/${poolId}`;
const patches = Object.freeze([
  { departmentId: '1d0e2994-4224-4237-8328-71020ba20027', path: 'department-assets/1d0e2994-4224-4237-8328-71020ba20027/patch-1787431778595.jpg' },
  { departmentId: 'd01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0', path: 'department-assets/d01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0/patch-1782439034425.png' },
]);
const mode = process.argv[2];
const subject = process.env.TRACEPOINT_REHEARSAL_COGNITO_SUB ?? '';
if (!['create', 'verify', 'cleanup'].includes(mode) || !isRehearsalCognitoSubject(subject)) throw Error('Fixture mode or subject invalid.');
const secret = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON ?? 'null');
if (secret?.host !== targetHost || secret?.dbname !== 'tracepoint' || secret?.port !== 5432 || secret?.username !== 'tracepoint_migrator' || typeof secret?.password !== 'string' || secret.password.length < 20) {
  throw Error('Rehearsal fixture target identity mismatch.');
}
const ca = readFileSync('/app/rds-ca.pem', 'utf8');
if (!ca.includes('BEGIN CERTIFICATE')) throw Error('Verified RDS CA unavailable.');
const client = new pg.Client({ host: targetHost, port: 5432, user: secret.username, password: secret.password,
  database: 'tracepoint', ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10_000,
  statement_timeout: 10_000, application_name: 'tracepoint-phase3c-fixed-auth-fixture' });

function requireOne(result, message) { if (result.rowCount !== 1) throw Error(message); }
function canonicalPatch(patch) { return '/api/settings/department-patch?path=' + encodeURIComponent(patch.path); }
async function identityChecks(mark) {
  mark('target-db-identity');
  const identity = await client.query("select current_database() as database, current_user as role, (select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls");
  if (identity.rows[0]?.database !== 'tracepoint' || identity.rows[0]?.role !== 'tracepoint_migrator' || identity.rows[0]?.tls !== true) throw Error('Database role, name, or TLS identity mismatch.');
  mark('target-patch-references');
  const departments = await client.query('select id,patch_url from public.departments where id=any($1::uuid[])', [patches.map(patch => patch.departmentId)]);
  if (departments.rowCount !== patches.length || patches.some(patch => departments.rows.find(row => row.id === patch.departmentId)?.patch_url !== canonicalPatch(patch))) throw Error('Imported department or patch reference mismatch.');
  mark('target-administrator-reference');
  const role = await client.query("select count(*)::int as count from public.roles where code='administrator'");
  if (role.rows[0].count !== 1) throw Error('Administrator reference role missing.');
  mark('target-audit-guard');
  const auditFunction = await client.query("select pg_get_functiondef('public.write_audit_event()'::regprocedure) as body");
  if (!auditFunction.rows[0]?.body?.includes("current_setting('tracepoint.migration_mode', true) = 'on'")) throw Error('Transaction-local audit guard is absent.');
}
async function fixtureCounts() {
  const result = await client.query(`select
    (select count(*)::int from auth.users where id=$1 and email=$2) as auth_users,
    (select count(*)::int from public.profiles where id=$1 and email=$2) as profiles,
    (select count(*)::int from public.department_memberships where user_id=$1 and department_id=any($3::uuid[]) and is_active) as memberships,
    (select count(*)::int from public.department_membership_roles where user_id=$1 and department_id=any($3::uuid[]) and role_code='administrator') as roles,
    (select count(*)::int from public.authentication_identity_links where provider='cognito' and issuer=$4 and subject=$5 and tracepoint_user_id=$1 and state='active') as links`,
    [userId, email, patches.map(patch => patch.departmentId), issuer, subject]);
  return result.rows[0];
}
function assertCounts(counts, expected) {
  for (const [name, count] of Object.entries(expected)) if (counts[name] !== count) throw Error(`Fixture ${name} count mismatch.`);
}

async function main() {
let phase = 'target-connect';
const mark = value => { phase = value; };
try {
  await client.connect();
  await identityChecks(mark);
  if (mode === 'verify') {
    mark('verify-fixture-counts');
    assertCounts(await fixtureCounts(), { auth_users: 1, profiles: 1, memberships: 2, roles: 2, links: 1 });
  } else {
    mark('transaction-begin');
    await client.query('begin');
    try {
      mark('transaction-local-guards');
      await client.query("set local tracepoint.migration_mode = 'on'");
      await client.query("set local lock_timeout = '5s'");
      await client.query("set local idle_in_transaction_session_timeout = '20s'");
      mark('audit-count-before');
      const auditBefore = (await client.query('select count(*)::int as count from public.audit_events')).rows[0].count;
      if (mode === 'create') {
        mark('fixture-clean-state');
        assertCounts(await fixtureCounts(), { auth_users: 0, profiles: 0, memberships: 0, roles: 0, links: 0 });
        mark('fixture-email-collision');
        const collision = await client.query('select count(*)::int as count from auth.users where email=$1', [email]);
        if (collision.rows[0].count !== 0) throw Error('Fixture email collision.');
        mark('fixture-subject-collision');
        const linkedSubject = await client.query('select count(*)::int as count from public.authentication_identity_links where provider=$1 and issuer=$2 and subject=$3', ['cognito', issuer, subject]);
        if (linkedSubject.rows[0].count !== 0) throw Error('Cognito subject collision.');
        mark('fixture-auth-anchor');
        requireOne(await client.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)',
          [userId, email, JSON.stringify({ full_name: 'TracePoint Rehearsal Tester', rehearsal_fixture: true })]), 'Auth anchor insert failed.');
        mark('fixture-profile-shell');
        requireOne(await client.query('update public.profiles set full_name=$2 where id=$1 and email=$3',
          [userId, 'TracePoint Rehearsal Tester', email]), 'Profile shell missing.');
        for (const patch of patches) {
          mark('fixture-membership');
          requireOne(await client.query('insert into public.department_memberships(department_id,user_id,is_active) values($1,$2,true)',
            [patch.departmentId, userId]), 'Membership insert failed.');
          mark('fixture-role');
          requireOne(await client.query("insert into public.department_membership_roles(department_id,user_id,role_code) values($1,$2,'administrator')",
            [patch.departmentId, userId]), 'Role insert failed.');
        }
        mark('fixture-identity-link');
        requireOne(await client.query("insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state) values('cognito',$1,$2,$3,'active')",
          [issuer, subject, userId]), 'Cognito mapping insert failed.');
        mark('fixture-postinsert-counts');
        assertCounts(await fixtureCounts(), { auth_users: 1, profiles: 1, memberships: 2, roles: 2, links: 1 });
      } else {
        assertCounts(await fixtureCounts(), { auth_users: 1, profiles: 1, memberships: 2, roles: 2, links: 1 });
        requireOne(await client.query('delete from auth.users where id=$1 and email=$2', [userId, email]), 'Fixture cleanup failed.');
        assertCounts(await fixtureCounts(), { auth_users: 0, profiles: 0, memberships: 0, roles: 0, links: 0 });
      }
      mark('audit-count-after');
      const auditAfter = (await client.query('select count(*)::int as count from public.audit_events')).rows[0].count;
      if (auditAfter !== auditBefore) throw Error('Fixture emitted audit side effects.');
      mark('transaction-commit');
      await client.query('commit');
    } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
  }
  console.log(JSON.stringify({ event: 'phase3c-rehearsal-auth-fixture', mode, result: 'PASS', userId, departmentCount: 2 }));
} catch (error) {
  console.error(JSON.stringify({ event: 'phase3c-rehearsal-auth-fixture', mode, result: 'FAIL', phase,
    errorClass: typeof error?.code === 'string' ? error.code : 'FAIL_CLOSED' }));
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
}
void main();
