import assert from "node:assert/strict";
import test from "node:test";
import { types as pgTypes } from "pg";
import { calendarDate } from "./calendar-date";

const DATE_OID = 1082;
/** Exactly what node-postgres hands back for a DATE column on the AWS-native runtime. */
const pgDate = (text: string) => pgTypes.getTypeParser(DATE_OID)(text) as unknown;

function inZone<T>(timeZone: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try { return run(); } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
}

test("node-postgres DATE values keep their calendar day in every host time zone", () => {
  for (const zone of ["UTC", "America/New_York", "America/Los_Angeles", "Pacific/Pago_Pago", "Pacific/Kiritimati", "Asia/Kolkata"]) {
    inZone(zone, () => {
      const value = pgDate("2026-09-14");
      assert.ok(value instanceof Date, `node-postgres returns a Date for DATE in ${zone}`);
      assert.equal(calendarDate(value), "2026-09-14", zone);
      assert.equal(calendarDate(pgDate("2024-02-29")), "2024-02-29", zone);
      assert.equal(calendarDate(pgDate("2026-12-31")), "2026-12-31", zone);
      assert.equal(calendarDate(pgDate("2027-01-01")), "2027-01-01", zone);
    });
  }
});

test("strings and serialized timestamps of a date-only column keep the written day", () => {
  assert.equal(calendarDate("2026-09-14"), "2026-09-14");
  assert.equal(calendarDate(" 2026-09-14 "), "2026-09-14");
  assert.equal(calendarDate("2026-09-14T00:00:00.000Z"), "2026-09-14");
  assert.equal(calendarDate("2026-09-14T23:30:00-05:00"), "2026-09-14");
  assert.equal(calendarDate("2026-09-14 00:00:00+00"), "2026-09-14");
});

test("anything that is not a real calendar date is null, never guessed", () => {
  for (const value of [null, undefined, "", "Undated", "09/14/2026", "2026-02-30", "2026-13-01", "2026-9-14", 20260914, new Date(Number.NaN), {}]) assert.equal(calendarDate(value), null, String(value));
});
