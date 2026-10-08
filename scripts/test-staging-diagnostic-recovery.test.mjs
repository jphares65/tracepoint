import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/aws-staging-runtime.yml', 'utf8');
const release = readFileSync('scripts/release-tracepoint-staging.ps1', 'utf8');

test('one-shot diagnostic provenance is staging-only and branch-bound', () => {
  assert.match(workflow, /if \('\$\{\{ github\.ref \}\}' -ne 'refs\/heads\/codex\/staging-mobile-api-release-20261007'\)/);
  assert.match(workflow, /merge-base --is-ancestor \$baseline '\$\{\{ github\.sha \}\}'/);
  assert.match(workflow, /TRACEPOINT_ONE_TIME_COGNITO_DIAGNOSTIC=true/);
  assert.doesNotMatch(workflow, /refs\/heads\/main.*diagnostic/i);
  assert.doesNotMatch(workflow, /production.*diagnostic/i);
});

test('baseline 404 diagnostic is pinned to the exact verified recovery image and not normal releases', () => {
  assert.match(release, /\$knownDiagnosticRecoveryDigest = 'sha256:cd1ccf7cd76a4e2a666e03609501a8096937536e56a53f45580d3fcef6ab1a53'/);
  assert.match(release, /if \(\$digest -ne \$knownDiagnosticRecoveryDigest\) \{ throw 'Diagnostic baseline is not the approved recovery image\.' \}/);
  assert.match(release, /--allow-known-diagnostic-baseline-mobile-404/);
  assert.match(release, /if \(\$AllowKnownStagingLoginDiagnostic\) \{[\s\S]*--verify-mobile-bearer-only[\s\S]*automatic rollback is required/s);
  assert.doesNotMatch(release, /allowKnownDiagnosticBaselineMobile404\s*=\s*\$true/);
});
