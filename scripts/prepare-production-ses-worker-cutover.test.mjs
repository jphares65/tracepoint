import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildStages } from './prepare-production-ses-worker-cutover.mjs';

const root = new URL('../infra/changesets/production-ses-worker-20260926/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const read = stage => JSON.parse(readFileSync(new URL(`${stage}.json`, root), 'utf8'));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('cutover and reverse stages are reproducible from the attested baseline', () => {
  const baseline = read('oldPaused');
  const mapping = 'WorkerSqsEventSourcetracepointproductionfullawssesFeedbackQueueAAC93C1D77138938';
  delete baseline.Resources[mapping].Properties.Enabled;
  assert.equal(sha(baseline), manifest.originalTemplateSha256);
  const generated = buildStages(baseline);
  for (const [stage, template] of Object.entries(generated)) {
    assert.deepEqual(template, read(stage));
    assert.equal(sha(template), manifest.stages[stage].sha256);
  }
});

test('the live-source and final-source paths never overlap in a stage', () => {
  for (const stage of ['oldPaused', 'finalPaused', 'finalActive', 'oldPinnedPaused', 'oldActive']) {
    const template = read(stage);
    const worker = template.Resources.Worker11F36D0F.Properties;
    const statement = template.Resources.WorkerRoleDefaultPolicy1750E153.Properties.PolicyDocument.Statement
      .find(item => item.Action?.includes?.('secretsmanager:GetSecretValue'));
    const isFinal = stage.startsWith('final');
    assert.equal(worker.Environment.Variables.TRACEPOINT_FEEDBACK_DATABASE_AUTHORITY,
      isFinal ? 'final' : undefined);
    assert.deepEqual(statement.Resource, worker.Environment.Variables.TRACEPOINT_DATABASE_SECRET_ARN);
    if (isFinal) {
      assert.equal(statement.Resource, manifest.finalSecret);
      assert.equal(worker.Code.S3ObjectVersion, manifest.finalCodeVersion);
    } else {
      assert.notEqual(JSON.stringify(statement.Resource), JSON.stringify(manifest.finalSecret));
    }
  }
});

test('mapping is paused for every authority transition and rollback', () => {
  for (const stage of ['oldPaused', 'finalPaused', 'oldPinnedPaused']) {
    const template = read(stage);
    assert.equal(template.Resources.WorkerSqsEventSourcetracepointproductionfullawssesFeedbackQueueAAC93C1D77138938.Properties.Enabled, false);
  }
  for (const stage of ['finalActive', 'oldActive']) {
    const template = read(stage);
    assert.equal(template.Resources.WorkerSqsEventSourcetracepointproductionfullawssesFeedbackQueueAAC93C1D77138938.Properties.Enabled, true);
  }
});
