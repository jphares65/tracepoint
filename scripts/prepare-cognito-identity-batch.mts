import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import { createIdentityBatchManifest } from './cognito-identity-batch-core.mjs';

const args = process.argv.slice(2);
const value = (name: string) => { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1] ?? ''; };
assert.ok(args.includes('--prepare'), 'Explicit --prepare is required');
const output = value('--output');
const actorUserId = value('--actor-user-id');
const authorizationReference = value('--authorization-reference');
assert.ok(output && actorUserId && authorizationReference, '--output, --actor-user-id, and --authorization-reference are required');

const [{ getPostgresPool }, { parseCognitoRuntimeConfiguration }] = await Promise.all([
  import('../src/lib/database/postgres-pool.ts'),
  import('../src/lib/authentication/cognito-runtime-configuration-core.ts'),
]);
const runtime = parseCognitoRuntimeConfiguration(process.env);
const pool = getPostgresPool();
try {
  const result = await pool.query<{ target_user_id: string; department_id: string }>(
    `select p.id::text as target_user_id,min(dm.department_id::text) as department_id
     from public.profiles p
     join public.department_memberships dm on dm.user_id=p.id and dm.is_active
     where nullif(btrim(p.email),'') is not null
       and not exists(select 1 from public.authentication_identity_links l where l.provider='cognito' and l.tracepoint_user_id=p.id and l.state in ('pending','active'))
     group by p.id order by p.id`,
  );
  assert.ok(result.rows.length > 0 && result.rows.length <= 10_000, 'Eligible identity batch size is invalid');
  const createdAt = new Date();
  const manifest = createIdentityBatchManifest({
    actorUserId,
    authorizationReference,
    clientId: runtime.verification.clientId,
    environment: runtime.verification.environment,
    expectedAccount: runtime.verification.account,
    expiresAt: new Date(createdAt.getTime() + 4 * 60 * 60 * 1000).toISOString(),
    issuer: `https://cognito-idp.${runtime.verification.region}.amazonaws.com/${runtime.verification.userPoolId}`,
    siteUrl: runtime.verification.environment === 'production' ? 'https://tracepointhq.com' : 'https://staging.tracepointhq.com',
    userPoolId: runtime.verification.userPoolId,
    users: result.rows.map(row => ({ departmentId: row.department_id, targetUserId: row.target_user_id })),
  }, createdAt.toISOString());
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ output, users: manifest.users.length, manifestSha256: manifest.contentSha256, expiresAt: manifest.expiresAt, emailAddressesPrinted: false }));
} finally {
  await pool.end();
}
