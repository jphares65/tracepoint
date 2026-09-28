import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyEmptyIdentitySequence } from './supabase-rest-import-core.mjs';

test('variable-count final import accepts an empty preserved-ID audit relation only with an advanced sequence', () => {
  assert.deepEqual(verifyEmptyIdentitySequence('retired_permission_assignment_audit', '1'), {
    relation: 'retired_permission_assignment_audit', lastValue: '1', maxImportedId: null,
    nextGeneratedIdCannotCollide: true, emptyRelation: true,
  });
  assert.throws(() => verifyEmptyIdentitySequence('audit_events', '0'), /IDENTITY_SEQUENCE_EMPTY_NOT_ADVANCED|IDENTITY_SEQUENCE_VALUE_INVALID/);
  assert.throws(() => verifyEmptyIdentitySequence('departments', '1'), /IDENTITY_PRESERVATION_RELATION_NOT_ALLOWED/);
});
