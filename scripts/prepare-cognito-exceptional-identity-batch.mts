import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import { createExceptionalIdentityBatchManifest } from './cognito-identity-batch-core.mjs';

const args = process.argv.slice(2);
const value = (name: string) => { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1] ?? ''; };
assert.ok(args.includes('--prepare-exceptional'), 'Explicit --prepare-exceptional is required');
const output = value('--output');
const actorUserId = value('--actor-user-id');
const authorizationReference = value('--authorization-reference');
assert.ok(output && actorUserId && authorizationReference, '--output, --actor-user-id, and --authorization-reference are required');

const [{ getPostgresPool }, { withPostgresSubjectAuthorization }, { parseCognitoTargetConfiguration }] = await Promise.all([
  import('../src/lib/database/postgres-pool.ts'),
  import('../src/lib/database/postgres-authorization-core.ts'),
  import('../src/lib/authentication/cognito-runtime-configuration-core.ts'),
]);
const runtime = parseCognitoTargetConfiguration(process.env);
const pool = getPostgresPool();
try {
  const result = await withPostgresSubjectAuthorization(pool, { subjectId: actorUserId }, async client => {
    const allowed = await client.query('select public.is_platform_admin() as allowed') as { rows: Array<{ allowed: boolean }> };
    assert.equal(allowed.rows[0]?.allowed, true, 'Actor is not an active platform administrator');
    return client.query(
      'select target_user_id::text,disposition from tracepoint_auth.list_exceptional_cognito_identities() limit 101',
    ) as Promise<{ rows: Array<{ target_user_id: string; disposition: 'inactive-disabled' | 'platform-administrator' }> }>;
  });
  assert.ok(result.rows.length >= 1 && result.rows.length <= 100, 'Exceptional identity preparation requires 1 to 100 eligible identities');
  const createdAt = new Date();
  const manifest = createExceptionalIdentityBatchManifest({
    actorUserId,
    authorizationReference,
    clientId: runtime.verification.clientId,
    environment: runtime.verification.environment,
    expectedAccount: runtime.verification.account,
    expiresAt: new Date(createdAt.getTime() + 4 * 60 * 60 * 1000).toISOString(),
    issuer: `https://cognito-idp.${runtime.verification.region}.amazonaws.com/${runtime.verification.userPoolId}`,
    userPoolId: runtime.verification.userPoolId,
    users: result.rows.map(row => ({ disposition: row.disposition, targetUserId: row.target_user_id })),
  }, createdAt.toISOString());
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const dispositions = Object.fromEntries([...new Set(manifest.users.map((user: { disposition: string }) => user.disposition))].sort().map(disposition => [disposition, manifest.users.filter((user: { disposition: string }) => user.disposition === disposition).length]));
  console.log(JSON.stringify({ output, users: manifest.users.length, dispositions, manifestSha256: manifest.contentSha256, expiresAt: manifest.expiresAt, emailAddressesPrinted: false, userIdsPrinted: false }));
} finally {
  await pool.end();
}
