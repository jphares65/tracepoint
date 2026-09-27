import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateProductionCompositeReadiness } from './validate-production-composite-preflight.mjs';

const inventory = JSON.parse(readFileSync(new URL('../docs/production-composite-preflight-evidence-20260927.json', import.meta.url)));

test('current production inventory blocks uncovered autonomous writers', () => {
  const result = evaluateProductionCompositeReadiness(inventory);
  assert.equal(result.status, 'PRODUCTION_COMPOSITE_PREFLIGHT_BLOCKED');
  assert.ok(result.blockers.includes('WRITER_CONTROL_UNPROVEN:authApi'));
  assert.ok(result.blockers.includes('WRITER_CONTROL_UNPROVEN:storageApi'));
  assert.ok(result.blockers.includes('UNKNOWN_AUTONOMOUS_WRITERS'));
  assert.ok(!result.blockers.includes('S3_WRITER_INVENTORY_OPEN'));
});

test('complete reversible controls and exact two-slot capture would pass', () => {
  const ready = structuredClone(inventory);
  ready.publicTables.triggerInstallAndAbortReviewed = true;
  ready.capture.immutableVersioned = true;
  ready.unfence.exactInverseReviewed = true;
  ready.unfence.restoreVerificationDefined = true;
  ready.unknownAutonomousWriters = false;
  for (const writer of Object.values(ready.writers)) {
    writer.inventoryComplete = true;
    writer.reversibleControlAvailable = true;
    writer.inverseReviewed = true;
    writer.realInterfaceNegativeRehearsed = true;
  }
  assert.equal(evaluateProductionCompositeReadiness(ready).status, 'PRODUCTION_COMPOSITE_PREFLIGHT_PASS');
  for (const change of [
    copy => { copy.s3WriterCredentials.productionProjectVerified = false; },
    copy => { copy.writers.authApi.realInterfaceNegativeRehearsed = false; },
    copy => { copy.capture.slots.B = copy.capture.slots.A; },
    copy => { copy.relationFingerprint = 'wrong'; },
  ]) {
    const copy = structuredClone(ready);
    change(copy);
    if (copy.relationFingerprint === 'wrong') assert.throws(() => evaluateProductionCompositeReadiness(copy));
    else assert.equal(evaluateProductionCompositeReadiness(copy).status, 'PRODUCTION_COMPOSITE_PREFLIGHT_BLOCKED');
  }
});
