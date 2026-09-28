import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const template = await readFile(new URL('../infra/changesets/production-final-import-proof-20260928/template.yml',
  import.meta.url), 'utf8');

test('synthetic import proof clone has only private one-shot ingress and exact paid artifacts', () => {
  assert.match(template, /DBSnapshotIdentifier: rds:tracepoint-production-final-cutover-20260926-2026-09-28-09-54/);
  assert.match(template, /DBInstanceIdentifier: tracepoint-production-final-import-proof-20260928/);
  assert.match(template, /PubliclyAccessible: false/);
  assert.match(template, /DeletionProtection: true/);
  assert.match(template, /SourceSecurityGroupId: !Ref ProofTaskSecurityGroup/);
  assert.match(template, /migration\/source-rehearsal\/463606ba-ce48-468d-a91c-57c8067a0d3b\/final-canonical\.json/);
  assert.match(template, /migration\/source-rehearsal\/90e721c1-039b-47f8-b02d-c4e79d6100c8\/final-canonical\.json/);
  assert.doesNotMatch(template, /0\.0\.0\.0\/0\s*\n\s*IpProtocol: tcp\s*\n\s*FromPort: 5432/);
  assert.doesNotMatch(template, /arn:aws:s3:::.*\/migration\/source\/c7448ea9-4645-4e99-b988-3a05de12ac70/);
  assert.doesNotMatch(template, /secretsmanager:GetSecretValue|ecs:UpdateService|route53:|cognito-idp:/);
  assert.match(template, /tracepoint-production@sha256:000483ddbeba124502a0f3928889c3b5888117d882ae0aae4fa9b8491135759d/);
  assert.match(template, /EntryPoint: \[node, scripts\/run-isolated-final-import-proof\.mjs\]/);
  assert.doesNotMatch(template, /Name: TRACEPOINT_ISOLATED_IMPORT_PROOF|Name: TRACEPOINT_ISOLATED_IMPORT_MODE/);
});
