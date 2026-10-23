import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The staging migration image is built from a CRLF archive; the contracts compare LF source.
const page = async () => (await readFile(new URL("./page.tsx", import.meta.url), "utf8")).replaceAll("\r\n", "\n");

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
  assert.match(source, /accept: serverAcceptance\(remote\.workspace \?\? \{\}, remote\.departmentId\)/, "load");
  assert.match(source, /const serverRule = serverAcceptance\(remote\.workspace \?\? \{\}, remote\.departmentId\);/, "recovery");
  assert.match(source, /error instanceof RefusedRangeWorkspaceError && refusalRecoveredFor\.current !== rangeWorkspaceBaseUpdatedAt/);
  assert.match(source, /void recoverRangeWorkspace\(error\.message\);/);
  assert.match(source, /return decision\.ok \? \{ ok: false as const, error: refusal \} : decision;/, "review R2-M3");
});

test("review H2/M4/L1/L4: one device record, per-snapshot epoch, random ids, conflict pill, other-tab notice", async () => {
  const source = await page();
  assert.doesNotMatch(source, /localStorage\.(getItem|setItem)/, "all storage goes through workspace-device-copy");
  assert.match(source, /usableDeviceCopy\(readDeviceCopy\(storage, currentUserId, remote\.departmentId\), \{ userId: currentUserId, departmentId: remote\.departmentId \}\)/);
  assert.match(source, /if \(persistDeviceCopy\(initial, conflicts\)\) afterPersist\(\);/);
  assert.match(source, /snapshotEpochs\.current\.get\(workspace\) !== rangeWorkspaceEpoch/);
  assert.doesNotMatch(source, /`(range|equipment|result|roster|malfunction)-\$\{(now|Date\.now\(\)|arrival\.getTime\(\))/);
  assert.match(source, /conflictedResultIds\.has\(existingResult\.id\) \? \(\n\s*<StatusPill label="Conflict" tone="amber" \/>/);
  assert.match(source, /event\.key\?\.startsWith\(`\$\{RANGE_DAY_DEVICE_COPY_KEY\}\.`\)/);
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
  assert.match(source, /conflict\.reason \? "Try this device\\u2019s value again" : "Use this device\\u2019s value"/);
  assert.match(source, /conflict\.reason \? "Discard this device\\u2019s value" : "Keep the current value"/);
  assert.match(source, /this device \$\{value\(conflict\.local\)\}, now \$\{value\(currentRecord\(latestWorkspaceState\.current, conflict\)\)\}/, "review ba6bccf R4-M1");
});

test("UX-RB-6: impossible values are stopped on the officer's row; pills reflect the server", async () => {
  const source = await page();
  const save = source.slice(source.indexOf("function handleSaveBatchResults()"), source.indexOf("function handleGeneratePacket()"));
  assert.match(save, /batchRowMeasurementError\(batchScoreRows\[entry\.officerId\], selectedDrill, selectedRunNumber\)/);
  assert.ok(save.indexOf("invalidMeasurements.length > 0") < save.indexOf("const savedResults ="));
  assert.match(source, /unsyncedResultIds\.has\(existingResult\.id\) \? \(\n\s*<StatusPill label="Not synced" tone="amber" \/>/);
  assert.equal(source.match(/aria-label=\{`Measurement for \$\{getUserName\(entry\.officerId\)\}`\}/g)?.length, 2);
});

test("review R2-H1/R2-M1: drill removal carries the version and never adopts the server's drill list; an edit decides a conflict", async () => {
  const source = await page();
  const removal = source.slice(source.indexOf("async function handleRemoveDrillFromSelectedRangeDay"), source.indexOf("const renderWorkspaceSaveStatus"));
  assert.match(removal, /baseUpdatedAt: rangeWorkspaceBaseUpdatedAt \?\? null/);
  assert.match(removal, /if \(payload\.code === "stale_workspace"\) \{\n\s*setWorkspaceStale\(true\);\n\s*void recoverRangeWorkspace\(\);/);
  assert.match(removal, /rangeWorkspaceEpoch \+= 1;/);
  assert.doesNotMatch(removal, /payload\.workspace\?\.rangeDayDrills/);
  assert.doesNotMatch(source, /liveConflicts/, "review 3177a83 P1: no edit elsewhere decides a conflict");
  assert.match(removal, /setRangeDayDrills\(\(current\) => current\.filter\(\(item\) => item\.id !== drill\.id\)\);/, "review 3177a83 P3");
  const batch = source.slice(source.indexOf("function handleSaveBatchResults()"), source.indexOf("function handleGeneratePacket()"));
  assert.match(batch, /if \(existingResult && !unsavedBatchOfficerIds\.current\.has\(entry\.officerId\)\) return \[\];/, "review 3177a83 P1: untouched saved results are not rebuilt");
});

test("review 2c073ae H1: a conflict choice the server would refuse is not applied; the entry stays listed with the reason", async () => {
  const source = await page();
  const resolve = source.slice(source.indexOf("function resolveWorkspaceConflict("), source.indexOf("function describeWorkspaceConflict("));
  assert.match(resolve, /const decision = serverAcceptance\(serverWorkspace\.current, deviceDepartmentId\.current\)\(workspace\);/);
  assert.ok(resolve.indexOf("if (!decision.ok)") < resolve.indexOf("applyMergeableWorkspace(workspace)"));
});
