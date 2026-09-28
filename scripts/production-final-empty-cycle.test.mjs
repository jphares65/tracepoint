import test from 'node:test';
import assert from 'node:assert/strict';
import { importNullableTrainingCertificationCycle } from './run-supabase-rest-initial-import.mjs';
import { NULLABLE_TRAINING_CERTIFICATION_CYCLE } from './supabase-rest-import-core.mjs';

test('an empty imported training/certification pair performs no writes or nested transaction', async () => {
  const cycle = NULLABLE_TRAINING_CERTIFICATION_CYCLE;
  const preflight = { cyclePlan: cycle,
    mappings: [{ relation: cycle.attendees }, { relation: cycle.certifications }],
    targetBefore: new Map([[cycle.attendees, 0], [cycle.certifications, 0]]) };
  const snapshot = { rows: new Map([[cycle.attendees, []], [cycle.certifications, []]]) };
  const client = { query: () => { throw new Error('EMPTY_CYCLE_MUST_NOT_QUERY'); } };
  assert.deepEqual(await importNullableTrainingCertificationCycle(client, snapshot, preflight), {
    relation: `${cycle.attendees}+${cycle.certifications}`, imported: 0, resumed: 0,
    strategy: 'empty-pair-no-write',
  });
  preflight.targetBefore.set(cycle.attendees, 1);
  await assert.rejects(importNullableTrainingCertificationCycle(client, snapshot, preflight),
    /CYCLE_TARGET_ATTENDEES_NOT_EMPTY/);
});
