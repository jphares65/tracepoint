import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIsolatedProofEnvironment } from './run-isolated-final-import-proof.mjs';

const host = 'tracepoint-production-final-import-proof-20260928.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const env = {
  TRACEPOINT_ISOLATED_IMPORT_PROOF: 'paid-capture-b-to-proof-rds-v1',
  TRACEPOINT_ISOLATED_IMPORT_MODE: 'rollback',
  TRACEPOINT_EXPECTED_AWS_ACCOUNT: '193644343389',
  TRACEPOINT_EXPECTED_AWS_REGION: 'us-east-1',
  TRACEPOINT_PROOF_RDS_HOST: host,
  TRACEPOINT_PROOF_RDS_RESOURCE_ID: 'db-ABC123',
  TARGET_DATABASE_SECRET_JSON: JSON.stringify({
    host: 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com',
    port: 5432, dbname: 'tracepoint', username: 'synthetic', password: 'synthetic',
  }),
};

test('isolated proof accepts only pinned paid-to-clone execution and never final RDS', () => {
  assert.equal(validateIsolatedProofEnvironment(env).mode, 'rollback');
  assert.equal(validateIsolatedProofEnvironment({ ...env, TRACEPOINT_ISOLATED_IMPORT_MODE: 'baseline' }).mode, 'baseline');
  assert.equal(validateIsolatedProofEnvironment({ ...env,
    TARGET_DATABASE_SECRET_JSON: JSON.stringify({ ...JSON.parse(env.TARGET_DATABASE_SECRET_JSON),
      host: 'tracepoint-production.c8r4sgs089tu.us-east-1.rds.amazonaws.com' }) }).mode, 'rollback');
  assert.equal(validateIsolatedProofEnvironment({ ...env, TRACEPOINT_ISOLATED_IMPORT_MODE: 'apply' }).mode, 'apply');
  for (const [key, value] of Object.entries({
    TRACEPOINT_ISOLATED_IMPORT_PROOF: 'capture-b-to-final-rds-v1',
    TRACEPOINT_ISOLATED_IMPORT_MODE: 'production',
    TRACEPOINT_EXPECTED_AWS_ACCOUNT: '265544358665',
    TRACEPOINT_PROOF_RDS_HOST: 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com',
    TRACEPOINT_PROOF_RDS_RESOURCE_ID: '',
  })) assert.throws(() => validateIsolatedProofEnvironment({ ...env, [key]: value }));
  assert.throws(() => validateIsolatedProofEnvironment({ ...env,
    TARGET_DATABASE_SECRET_JSON: JSON.stringify({ ...JSON.parse(env.TARGET_DATABASE_SECRET_JSON),
      host: 'unrelated.c8r4sgs089tu.us-east-1.rds.amazonaws.com' }) }),
  /ISOLATED_PROOF_SECRET_SOURCE_MISMATCH/);
});
