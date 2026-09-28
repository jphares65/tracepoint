#!/usr/bin/env node
import assert from 'node:assert/strict';

const action = process.env.TRACEPOINT_FINAL_IMPORT_ACTION;
assert.ok(action === 'database' || action === 'objects', 'FINAL_IMPORT_ACTION_REQUIRED');
try {
  const run = action === 'database'
    ? (await import('./run-production-final-atomic-import.mjs')).runFinalImport
    : (await import('./run-production-final-object-copy.mjs')).runFinalObjectCopy;
  console.log(JSON.stringify(await run()));
} catch (error) {
  const code = /^[A-Z][A-Z0-9_:]*$/.test(String(error?.message)) ? error.message :
    'FINAL_IMPORT_TASK_FAILED';
  console.error(JSON.stringify({ status: 'BLOCKED', action, code }));
  process.exitCode = 1;
}
