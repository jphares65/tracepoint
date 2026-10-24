import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertStagingTaskRevision } from './staging-acceptance-revision-policy.mjs';

test('new acceptance stays pinned to revision 194', () => {
  assert.equal(assertStagingTaskRevision('arn:aws:ecs:us-east-1:559054714699:task-definition/tracepoint-staging:194'), '194');
  assert.throws(() => assertStagingTaskRevision('arn:aws:ecs:us-east-1:559054714699:task-definition/tracepoint-staging:195'), /pinned/);
});

test('owned-fixture recovery remains available after a staging deployment advances', () => {
  assert.equal(assertStagingTaskRevision('arn:aws:ecs:us-east-1:559054714699:task-definition/tracepoint-staging:194', 'recovery'), '194');
  assert.equal(assertStagingTaskRevision('arn:aws:ecs:us-east-1:559054714699:task-definition/tracepoint-staging:207', 'recovery'), '207');
  assert.throws(() => assertStagingTaskRevision('arn:aws:ecs:us-east-1:559054714699:task-definition/tracepoint-staging:193', 'recovery'), /baseline/);
  assert.throws(() => assertStagingTaskRevision('not-a-task-revision', 'recovery'), /invalid/);
  assert.throws(() => assertStagingTaskRevision('arn:aws:ecs:us-east-1:559054714699:task-definition/tracepoint-staging:207', 'unknown'), /Unsupported/);
});
