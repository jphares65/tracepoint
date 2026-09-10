import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { createIdentityBatchCompletion, createIdentityBatchManifest } from './cognito-identity-batch-core.mjs';

const args = process.argv.slice(2);
const value = (name: string) => { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1] ?? ''; };
assert.ok(args.includes('--prepare'), 'Explicit --prepare is required');
const output = value('--output');
const actorUserId = value('--actor-user-id');
const departmentId = value('--department-id');
const authorizationReference = value('--authorization-reference');
const afterUserId = value('--after-user-id');
assert.ok(output && actorUserId && departmentId && authorizationReference, '--output, --actor-user-id, --department-id, and --authorization-reference are required');

const [{ getPostgresPool }, { withPostgresAuthorization }, { parseCognitoTargetConfiguration }] = await Promise.all([
  import('../src/lib/database/postgres-pool.ts'),
  import('../src/lib/database/postgres-authorization-core.ts'),
  import('../src/lib/authentication/cognito-runtime-configuration-core.ts'),
]);
const runtime = parseCognitoTargetConfiguration(process.env);
const pool = getPostgresPool();
try {
  const result = await withPostgresAuthorization(pool, { subjectId: actorUserId, departmentId }, async client => {
    const allowed = await client.query("select public.has_department_permission($1,'administer_department') as allowed", [departmentId]) as { rows: Array<{ allowed: boolean }> };
    assert.equal(allowed.rows[0]?.allowed, true, 'Actor cannot administer the selected department');
    return client.query(
      `select p.id::text as target_user_id,dm.department_id::text as department_id,lower(btrim(p.email)) as email
       from public.profiles p join public.department_memberships dm on dm.user_id=p.id and dm.is_active
       where dm.department_id=$1 and nullif(btrim(p.email),'') is not null
         and not exists(select 1 from public.authentication_identity_links l where l.provider='cognito' and l.tracepoint_user_id=p.id)
         and ($2::uuid is null or p.id > $2::uuid)
       order by p.id limit 100`,
      [departmentId, afterUserId || null],
    ) as Promise<{ rows: Array<{ target_user_id: string; department_id: string; email: string }> }>;
  });
  assert.ok(result.rows.length <= 100, 'Eligible identity batch cannot exceed 100 users');
  if (runtime.verification.environment === 'staging') {
    const allowlist = new Set((process.env.TRACEPOINT_STAGING_IDENTITY_RECIPIENT_SHA256 ?? '').split(',').filter(value => /^[0-9a-f]{64}$/.test(value)));
    assert.ok(allowlist.size > 0 && result.rows.every(row => allowlist.has(createHash('sha256').update(row.email).digest('hex'))), 'Every staging recipient must be explicitly allowlisted by email SHA-256');
  }
  const createdAt = new Date();
  const common = {
    actorUserId,
    authorizationReference,
    clientId: runtime.verification.clientId,
    environment: runtime.verification.environment,
    expectedAccount: runtime.verification.account,
    expiresAt: new Date(createdAt.getTime() + 4 * 60 * 60 * 1000).toISOString(),
    issuer: `https://cognito-idp.${runtime.verification.region}.amazonaws.com/${runtime.verification.userPoolId}`,
    siteUrl: runtime.verification.environment === 'production' ? 'https://tracepointhq.com' : 'https://staging.tracepointhq.com',
    userPoolId: runtime.verification.userPoolId,
  };
  if (result.rows.length === 0) {
    const completion = createIdentityBatchCompletion({ ...common, departmentId, afterUserId }, createdAt.toISOString());
    await writeFile(output, `${JSON.stringify(completion, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ output, complete: true, departmentId, afterUserId: afterUserId || null, contentSha256: completion.contentSha256, emailAddressesPrinted: false }));
  } else {
    const manifest = createIdentityBatchManifest({
      ...common,
      users: result.rows.map(row => ({ departmentId: row.department_id, targetUserId: row.target_user_id })),
    }, createdAt.toISOString());
    await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ output, users: manifest.users.length, manifestSha256: manifest.contentSha256, expiresAt: manifest.expiresAt, emailAddressesPrinted: false }));
  }
} finally {
  await pool.end();
}
