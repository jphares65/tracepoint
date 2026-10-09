import assert from 'node:assert/strict';
import test from 'node:test';
import {matchesImmutableRuntimeImage} from './staging-release-evidence-core.mjs';

const digest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

test('accepts the ECR tag digest after ECS resolves the image reference', () => {
  assert.equal(matchesImmutableRuntimeImage({
    expectedDigest: digest,
    runningDigest: digest,
  }), true);
});

test('rejects a different runtime digest', () => {
  assert.equal(matchesImmutableRuntimeImage({
    expectedDigest: digest,
    runningDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  }), false);
});

test('rejects malformed or absent digests', () => {
  assert.equal(matchesImmutableRuntimeImage({expectedDigest: digest, runningDigest: 'not-a-digest'}), false);
  assert.equal(matchesImmutableRuntimeImage({expectedDigest: undefined, runningDigest: digest}), false);
});
