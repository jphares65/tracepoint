import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = () => readFile(new URL("./page.tsx", import.meta.url), "utf8");

test("UX-RB-5: a stale save is recovered by merging, never by reloading the page", async () => {
  const source = await page();
  assert.doesNotMatch(source, /window\.location\.reload\(\)/);
  assert.match(source, /if \(error instanceof StaleRangeWorkspaceError\) \{\n        setWorkspaceStale\(true\);\n        void recoverRangeWorkspace\(\);/);
  assert.match(source, /const merge = mergeRangeWorkspace\(syncedWorkspace\.current, latestWorkspaceState\.current, serverForm\);/);
  assert.match(source, /setWorkspaceStale\(false\);/);
});

test("UX-RB-5: unsynced local changes survive a reload and an unknown base is never saved", async () => {
  const source = await page();
  assert.match(source, /if \(localCopy && \(syncState \|\| remote\.workspace === null\)\) \{/);
  assert.match(source, /if \(workspaceSyncBlockedRef\.current\) \{\n      throw new Error\("Not synced/);
  assert.match(source, /workspaceSyncBlockedRef\.current = true;/);
});

test("UX-RB-5: conflicts are shown with both values and a choice", async () => {
  const source = await page();
  assert.match(source, /\{workspaceConflictPanel\}/);
  assert.match(source, /Use this device&apos;s value/);
  assert.match(source, /Keep other device&apos;s value/);
});

test("UX-RB-6: impossible values are stopped on the officer's row; pills reflect the server", async () => {
  const source = await page();
  const save = source.slice(source.indexOf("function handleSaveBatchResults()"), source.indexOf("function handleGeneratePacket()"));
  assert.match(save, /batchRowMeasurementError\(batchScoreRows\[entry\.officerId\], selectedDrill, selectedRunNumber\)/);
  assert.ok(save.indexOf("invalidMeasurements.length > 0") < save.indexOf("const savedResults ="));
  assert.match(source, /unsyncedResultIds\.has\(existingResult\.id\) \? \(\n\s*<StatusPill label="Not synced" tone="amber" \/>/);
  assert.equal(source.match(/aria-label=\{`Measurement for \$\{getUserName\(entry\.officerId\)\}`\}/g)?.length, 2);
});
