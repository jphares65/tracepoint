import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const buildspec = readFileSync(new URL('../buildspec.aws-native-production.yml', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../Dockerfile.aws-native-production', import.meta.url), 'utf8');

test('production-native build requires exact account, production origin, and no Supabase build credentials', () => {
  assert.match(buildspec, /AWS_ACCOUNT_ID\" = \"193644343389/);
  assert.match(buildspec, /TRACEPOINT_BUILD_PROVIDER_MODE\" = \"aws-native-production/);
  assert.match(buildspec, /NEXT_PUBLIC_SITE_URL\" = \"https:\/\/tracepointhq\.com/);
  assert.match(buildspec, /test -z \"\$\{NEXT_PUBLIC_SUPABASE_URL:-\}\"/);
  assert.match(buildspec, /test -z \"\$\{NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-\}\"/);
  assert.match(buildspec, /IMAGE_TAG\" = \"\$SOURCE_COMMIT/);
  assert.match(buildspec, /Dockerfile\.aws-native-production/);
  assert.doesNotMatch(buildspec, /Dockerfile\.shadow/);
});

test('production-native runtime is non-root, verifies RDS CA, and excludes rehearsal-only artifacts', () => {
  const runtime = dockerfile.slice(dockerfile.indexOf('FROM gcr.io/distroless'));
  assert.match(runtime, /distroless\/nodejs24-debian13:nonroot/);
  assert.match(runtime, /COPY --from=builder --chown=nonroot:nonroot \/app\/rds-ca\.pem/);
  assert.match(runtime, /USER nonroot/);
  assert.match(dockerfile, /truststore\.pki\.rds\.amazonaws\.com\/us-east-1\/us-east-1-bundle\.pem/);
  assert.doesNotMatch(runtime, /COPY[^\n]*(?:phase3c-|database\/rehearsal|SUPABASE)/i);
  assert.match(buildspec, /Rehearsal fixture entered production image/);
});
