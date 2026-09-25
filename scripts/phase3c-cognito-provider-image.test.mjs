import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

test('the reviewed Cognito schema task and exact SQL are packaged in the shadow image', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile.shadow', import.meta.url), 'utf8');
  const ignore = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8');
  assert.match(ignore, /^!database\/aws\/025_cognito_provider_username_reconciliation\.sql$/m);
  assert.match(dockerfile, /esbuild scripts\/phase3c-cognito-provider-schema\.mjs --bundle --platform=node --format=cjs/);
  assert.match(dockerfile, /COPY --from=builder .*\/app\/database\/aws\/025_cognito_provider_username_reconciliation\.sql/);
});
