import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = () => readFile(new URL("./page.tsx", import.meta.url), "utf8");

test("UX-RB-5: a stale save is recovered by merging, never by reloading the page", async () => {
  const source = await page();
  assert.doesNotMatch(source, /window\.location\.reload\(\)/);
  assert.match(source, /if \(error instanceof StaleRangeWorkspaceError\) \{\n        setWorkspaceStale\(true\);\n        void recoverRangeWorkspace\(\);/);
  assert.match(source, /base: baseKnown\.current \? syncedWorkspace\.current : null,\n\s*local: latestWorkspaceState\.current,/);
  assert.match(source, /setWorkspaceStale\(false\);/);
});

test("review H1: merged changes are checked with the server's own decision; any other refusal recovers once per version", async () => {
  const source = await page();
  assert.match(source, /previewRangeWorkspaceMutation\(\{\n\s*existingWorkspace: remoteWorkspace,\n\s*nextWorkspace: workspaceSnapshotFor\(workspace, baseline\),/);
  assert.equal(source.match(/accept: serverAcceptance\(remote\.workspace \?\? \{\}\)/g)?.length, 2, "load and recovery");
  assert.match(source, /error instanceof RefusedRangeWorkspaceError && refusalRecoveredFor\.current !== rangeWorkspaceBaseUpdatedAt/);
});

test("review H2/M4/L1/L4: one device record, per-snapshot epoch, random ids, conflict pill, other-tab notice", async () => {
  const source = await page();
  assert.doesNotMatch(source, /localStorage\.(getItem|setItem)/, "all storage goes through workspace-device-copy");
  assert.match(source, /usableDeviceCopy\(stored, \{ userId: currentUserId, departmentId: remote\.departmentId \}\)/);
  assert.match(source, /persistDeviceCopy\(initial, conflicts\);/);
  assert.match(source, /snapshotEpochs\.current\.get\(workspace\) !== rangeWorkspaceEpoch/);
  assert.doesNotMatch(source, /`(result|roster|malfunction)-\$\{(now|Date\.now\(\)|arrival\.getTime\(\))/);
  assert.match(source, /conflictedResultIds\.has\(existingResult\.id\) \? \(\n\s*<StatusPill label="Conflict" tone="amber" \/>/);
  assert.match(source, /event\.key !== RANGE_DAY_DEVICE_COPY_KEY/);
  assert.equal(source.match(/\{deviceCopyNotice\}/g)?.length, 2);
});

test("UX-RB-5: unsynced local changes survive a reload and an unknown base is never saved", async () => {
  const source = await page();
  assert.match(source, /if \(copy\) \{\n\s*const recovered = recoverWorkspace\(\{/);
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
