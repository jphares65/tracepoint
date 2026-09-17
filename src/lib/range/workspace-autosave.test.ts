import assert from "node:assert/strict";
import test from "node:test";

import { LatestWorkspaceSaveQueue } from "./workspace-autosave.ts";

type WorkspaceSnapshot = {
  attendanceMode: "Scheduled Roster" | "Open / Rolling";
  drillId: string;
  runNumber: number;
  firearmId: string;
  notes: string;
};

test("serializes rapid saves and preserves the newest pending snapshot", async () => {
  const queue = new LatestWorkspaceSaveQueue<number>();
  const saved: number[] = [];
  const states: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const save = async (value: number) => {
    saved.push(value);
    if (value === 1) await first;
  };
  const state = (nextState: string) => states.push(nextState);

  queue.schedule(1, 0, save, state);
  await new Promise((resolve) => setTimeout(resolve, 5));
  queue.schedule(2, 0, save, state);
  queue.schedule(3, 0, save, state);
  releaseFirst?.();
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.deepEqual(saved, [1, 3]);
  assert.deepEqual(states, ["saving", "saving", "saved"]);
  queue.dispose();
});

test("preserves a failed snapshot for an explicit retry", async () => {
  const queue = new LatestWorkspaceSaveQueue<number>();
  const saved: number[] = [];
  const states: string[] = [];
  let shouldFail = true;
  const save = async (value: number) => {
    saved.push(value);
    if (shouldFail) throw new Error("temporary failure");
  };
  const onState = (state: string) => states.push(state);

  queue.schedule(7, 0, save, onState);
  await new Promise((resolve) => setTimeout(resolve, 5));
  shouldFail = false;
  queue.retry(save, onState);
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.deepEqual(saved, [7, 7]);
  assert.deepEqual(states, ["saving", "error", "saving", "saved"]);
  queue.dispose();
});

test("flushes an explicit save through the same latest-snapshot queue", async () => {
  const queue = new LatestWorkspaceSaveQueue<number>();
  const saved: number[] = [];
  const states: string[] = [];
  const save = async (value: number) => {
    saved.push(value);
  };
  const onState = (state: string) => states.push(state);

  queue.schedule(4, 250, save, onState);
  await queue.flushNow(save, onState);

  assert.deepEqual(saved, [4]);
  assert.deepEqual(states, ["saving", "saved"]);
  queue.dispose();
});

test("does not publish a stale save response after a newer snapshot is pending", async () => {
  const queue = new LatestWorkspaceSaveQueue<number>();
  const states: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const save = async (value: number) => {
    if (value === 1) await first;
  };
  const onState = (state: string) => states.push(state);

  queue.schedule(1, 0, save, onState);
  await new Promise((resolve) => setTimeout(resolve, 5));
  queue.schedule(2, 0, save, onState);
  releaseFirst?.();
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.deepEqual(states, ["saving", "saving", "saved"]);
  queue.dispose();
});

test("persists attendance mode, drill/run selection, and range-day firearm in one reloadable snapshot", async () => {
  const queue = new LatestWorkspaceSaveQueue<WorkspaceSnapshot>();
  let persisted: WorkspaceSnapshot | undefined;
  const snapshot: WorkspaceSnapshot = {
    attendanceMode: "Open / Rolling",
    drillId: "drill-1",
    runNumber: 2,
    firearmId: "firearm-1",
    notes: "Walk-up shooter arrived.",
  };

  queue.schedule(snapshot, 0, async (value) => {
    persisted = value;
  }, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.deepEqual(persisted, snapshot);
  queue.dispose();
});

test("debounces free-text snapshots and retains the newest text", async () => {
  const queue = new LatestWorkspaceSaveQueue<WorkspaceSnapshot>();
  const saved: string[] = [];
  const base: WorkspaceSnapshot = {
    attendanceMode: "Scheduled Roster",
    drillId: "drill-1",
    runNumber: 1,
    firearmId: "firearm-1",
    notes: "",
  };

  queue.schedule({ ...base, notes: "first" }, 25, async (value) => {
    saved.push(value.notes);
  }, () => undefined);
  queue.schedule({ ...base, notes: "latest" }, 25, async (value) => {
    saved.push(value.notes);
  }, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(saved, []);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(saved, ["latest"]);
  queue.dispose();
});
