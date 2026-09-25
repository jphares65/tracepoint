import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

test('the isolated retry runner packages only the fixed hash-pinned SQL', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile.shadow', import.meta.url), 'utf8');
  const ignore = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('./phase3c-invite-retry-schema.mjs', import.meta.url), 'utf8');
  const sql = readFileSync(new URL('../database/aws/027_cognito_invite_retry_claim.sql', import.meta.url), 'utf8')
    .replaceAll('\r\n', '\n');
  const hash = createHash('sha256').update(sql).digest('hex');
  assert.match(ignore, /^!database\/aws\/027_cognito_invite_retry_claim\.sql$/m);
  assert.match(dockerfile, /esbuild scripts\/phase3c-invite-retry-schema\.mjs --bundle --platform=node --format=cjs/);
  assert.match(dockerfile, /COPY --from=builder .*\/app\/database\/aws\/027_cognito_invite_retry_claim\.sql/);
  assert.ok(runner.includes(hash), 'runner must require exact reviewed SQL');
  assert.match(runner, /FIXED_REHEARSAL_INVITE_RETRY_MODE_REQUIRED/);
  assert.match(runner, /REHEARSAL_TARGET_PIN_MISMATCH/);
  assert.match(runner, /REHEARSAL_TARGET_IDENTITY_MISMATCH/);
  assert.match(runner, /INVITE_RETRY_PREFLIGHT_MISMATCH/);
});
