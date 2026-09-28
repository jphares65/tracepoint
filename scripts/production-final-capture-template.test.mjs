import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const template = await readFile(new URL('../infra/changesets/production-source-capture-20260927/template.yml',
  import.meta.url), 'utf8');
const rolePolicy = template.split(/  CaptureRole:\r?\n/)[1]?.split(/  CaptureProject:\r?\n/)[0];
const runIds = ['1d761bd7-04dd-43f3-b77a-2c41130e18c2',
  'c7448ea9-4645-4e99-b988-3a05de12ac70'];

test('capture role has only exact A/B object archive prefixes and sidecars', () => {
  assert.ok(rolePolicy, 'CAPTURE_ROLE_POLICY_MISSING');
  const resources = [...rolePolicy.matchAll(/^\s+- arn:aws:s3:::tracepoint-production-private-193644343389\/(.+)$/gm)]
    .map(match => match[1]);
  const expected = runIds.flatMap(id => [
    `migration/source/${id}/final-canonical.json`,
    `migration/source/${id}/object-archive.json`,
    `migration/source/${id}/objects/department-assets/*`,
    `migration/source/${id}/objects/tracepoint-attachments/*`,
  ]);
  assert.deepEqual(resources.sort(), expected.sort());
  assert.match(rolePolicy, /Resource: arn:aws:s3:::tracepoint-production-private-193644343389\/migration\/source\/composite-fence-20260927\/attestation\.json/);
  assert.doesNotMatch(rolePolicy, /arn:aws:s3:::tracepoint-production-private-193644343389\/\*/);
  assert.match(rolePolicy, /ReadOnlyExactProductionCaptureEpochCredential/);
  assert.doesNotMatch(rolePolicy, /source-production-epoch-rollback-20260928/);
});
