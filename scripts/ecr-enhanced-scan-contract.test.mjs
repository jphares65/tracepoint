import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const scripts = [
  'scripts/execute-database-migration-runner.ps1',
  'scripts/execute-cognito-identity-migration-runner.ps1',
  'scripts/prepare-cognito-identity-migration-batch.ps1',
  'scripts/execute-full-aws-production-rollback.ps1',
  'scripts/publish-staging-identity-migration-image.ps1',
];

test('migration and rollback gates read enhanced ECR scan findings by digest', () => {
  for (const path of scripts) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /ecr describe-image-scan-findings/);
    assert.match(source, /imageScanFindings\.findingSeverityCounts/);
    assert.doesNotMatch(source, /imageDetails\[0\]\.imageScanStatus/);
    assert.doesNotMatch(source, /imageScanFindingsSummary/);
  }
});
