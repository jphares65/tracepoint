import assert from "node:assert/strict";
import test from "node:test";
import { formatDate, formatDateTime } from "./date.ts";

test("date-only display preserves its calendar day", () => assert.equal(formatDate("2026-09-30"), "09/30/2026"));
test("date-only display preserves a UTC-midnight calendar day", () => {
  assert.equal(formatDate("2026-10-02T00:00:00.000Z"), "10/02/2026");
});
test("certification expiration dates preserve their UTC calendar day", () => {
  assert.equal(formatDate("2027-09-11T00:00:00.000Z"), "09/11/2027");
});
test("timestamps use a concise local display without ISO artifacts", () => {
  const display = formatDateTime("2026-09-30T14:32:18.123456Z");
  assert.match(display, /^09\/30\/2026 \d{1,2}:32 [AP]M$/);
  assert.doesNotMatch(display, /(?:Z|T|\.123|UTC)/);
});
test("invalid and absent values have a safe presentation fallback", () => {
  assert.equal(formatDate("not-a-date"), "—"); assert.equal(formatDateTime(null), "—");
});
