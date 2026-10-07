import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NATIVE_RELEASE_BASELINE, NATIVE_RELEASE_BRANCH, validateNativeReleaseProvenance } from './staging-native-release-governance-core.mjs';

test('admits only the exact native release branch with the approved ancestry', () => {
  assert.equal(validateNativeReleaseProvenance({ branch: NATIVE_RELEASE_BRANCH, head: 'a'.repeat(40), baselineIsAncestor: true }), true);
});

test('rejects unrelated branches and stale native lineage', () => {
  assert.throws(() => validateNativeReleaseProvenance({ branch: 'codex/unrelated-feature', head: 'a'.repeat(40), baselineIsAncestor: true }));
  assert.throws(() => validateNativeReleaseProvenance({ branch: NATIVE_RELEASE_BRANCH, head: 'a'.repeat(40), baselineIsAncestor: false }), new RegExp(NATIVE_RELEASE_BASELINE));
});

test('publisher and workflow bind the exact branch and ancestry guard', () => {
  const publisher = readFileSync(new URL('./publish-tracepoint-staging-image.ps1', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../.github/workflows/aws-staging-runtime.yml', import.meta.url), 'utf8');
  const previewGate = readFileSync(new URL('./wait-for-staging-preview.mjs', import.meta.url), 'utf8');
  assert.match(publisher, new RegExp(NATIVE_RELEASE_BRANCH));
  assert.match(publisher, new RegExp(NATIVE_RELEASE_BASELINE));
  assert.match(publisher, /merge-base --is-ancestor/);
  assert.match(workflow, new RegExp(NATIVE_RELEASE_BRANCH));
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: aws-staging/);
  assert.match(previewGate, new RegExp(NATIVE_RELEASE_BRANCH));
});
