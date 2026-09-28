import test from 'node:test';
import assert from 'node:assert/strict';
import { proofTaskOverrides } from './run-isolated-final-import-proof-task.mjs';

test('proof task override permits only rollback or apply on the isolated entrypoint', () => {
  for (const mode of ['baseline', 'rollback', 'apply']) {
    assert.deepEqual(proofTaskOverrides(mode), { containerOverrides: [{
      name: 'isolated-import-proof', environment: [
        { name: 'TRACEPOINT_ISOLATED_IMPORT_PROOF', value: 'paid-capture-b-to-proof-rds-v1' },
        { name: 'TRACEPOINT_ISOLATED_IMPORT_MODE', value: mode },
      ],
    }] });
  }
  for (const mode of ['production', 'final', '', undefined])
    assert.throws(() => proofTaskOverrides(mode), /ISOLATED_PROOF_MODE_REQUIRED/);
});
