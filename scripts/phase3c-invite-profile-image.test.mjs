import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

test('the fixed rehearsal invite repair is packaged with its pinned SQL', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile.shadow', import.meta.url), 'utf8');
  const ignore = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('./phase3c-invite-profile-schema.mjs', import.meta.url), 'utf8');
  const sql = readFileSync(new URL('../database/aws/026_cognito_invite_profile_trigger_reconciliation.sql', import.meta.url), 'utf8')
    .replaceAll('\r\n', '\n');
  const hash = createHash('sha256').update(sql).digest('hex');
  assert.match(ignore, /^!database\/aws\/026_cognito_invite_profile_trigger_reconciliation\.sql$/m);
  assert.match(dockerfile, /esbuild scripts\/phase3c-invite-profile-schema\.mjs --bundle --platform=node --format=cjs/);
  assert.match(dockerfile, /COPY --from=builder .*\/app\/database\/aws\/026_cognito_invite_profile_trigger_reconciliation\.sql/);
  assert.ok(runner.includes(hash), 'runner must require the exact reviewed migration hash');
  assert.match(runner, /REHEARSAL_TARGET_PIN_MISMATCH/);
  assert.match(runner, /SOURCE_PROFILE_TRIGGER_CONTRACT_MISMATCH/);
  assert.match(runner, /REHEARSAL_TARGET_IDENTITY_MISMATCH/);
});
