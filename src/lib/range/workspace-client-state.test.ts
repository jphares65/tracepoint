import assert from "node:assert/strict";
import test from "node:test";

import { preserveUnsavedBatchRows, withStoredCopiesOfUnchangedRecords } from "./workspace-client-state.ts";

test("unchanged records are sent as stored; edited and new records are sent as edited", () => {
  const stored = [{ id: "day-1", title: "A" }, { id: "day-2", title: "B" }];
  const normalized = stored.map((day) => ({ ...day, attendanceMode: "scheduled_roster", outline: ["Safety"] }));
  const current = [normalized[0], { ...normalized[1], title: "B2" }, { id: "day-3", title: "C" }];
  assert.deepEqual(withStoredCopiesOfUnchangedRecords(current, normalized, stored), [
    stored[0],
    { id: "day-2", title: "B2", attendanceMode: "scheduled_roster", outline: ["Safety"] },
    { id: "day-3", title: "C" },
  ]);
});

test("RNG-08: unsaved typed scores survive a row rebuild for officers still present", () => {
  const rebuilt = { a: { metricValue: "" }, b: { metricValue: "230" } };
  const current = { a: { metricValue: "241" }, b: { metricValue: "230" }, gone: { metricValue: "199" } };
  assert.deepEqual(preserveUnsavedBatchRows(rebuilt, current, new Set(["a", "gone"])), {
    a: { metricValue: "241" },
    b: { metricValue: "230" },
  });
  assert.deepEqual(preserveUnsavedBatchRows(rebuilt, current, new Set()), rebuilt);
});
