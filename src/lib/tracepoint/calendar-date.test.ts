import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeCalendarDate } from "./calendar-date.ts";

test("normalizes PostgreSQL and PostgREST calendar dates", () => {
  assert.equal(normalizeCalendarDate("2026-09-11"), "2026-09-11");
  assert.equal(normalizeCalendarDate("2026-09-11T00:00:00.000Z"), "2026-09-11");
  assert.equal(normalizeCalendarDate(new Date("2026-09-11T00:00:00.000Z")), "2026-09-11");
  assert.equal(normalizeCalendarDate("not-a-date"), null);
  assert.equal(normalizeCalendarDate(null), null);
});
