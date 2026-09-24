import assert from "node:assert/strict";
import test from "node:test";
import { notificationDateValue } from "./date-value.ts";

test("notification sorting accepts PostgreSQL timestamptz Date and legacy string values", () => {
  const iso = "2026-09-24T12:00:00.000Z";
  assert.equal(notificationDateValue(new Date(iso)), notificationDateValue(iso));
  assert.equal(notificationDateValue("2026-09-24"), new Date("2026-09-24T00:00:00").getTime());
  assert.equal(notificationDateValue(new Date(NaN)), 0);
  assert.equal(notificationDateValue(null), 0);
});
