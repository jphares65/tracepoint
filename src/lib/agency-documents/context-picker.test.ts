import assert from "node:assert/strict";
import test from "node:test";
import { types as pgTypes } from "pg";
import { qualificationPickerItem } from "./context-picker";

const pgDate = (text: string) => pgTypes.getTypeParser(1082)(text) as Date;

test("the qualification picker labels AWS-native DATE values by their calendar day, not Undated", () => {
  assert.deepEqual(qualificationPickerItem({ id: "q", qualification_date: pgDate("2026-09-14"), score: 287, passed: true, historical_course_name: "Day Handgun" }), { id: "q", label: "09/14/2026", detail: "Day Handgun · Score 287 · Pass" });
  assert.equal(qualificationPickerItem({ id: "q", qualification_date: "2026-09-14" }).label, "09/14/2026");
  assert.equal(qualificationPickerItem({ id: "q", qualification_date: "2026-09-14T00:00:00.000Z" }).label, "09/14/2026");
  assert.equal(qualificationPickerItem({ id: "q", qualification_date: null }).label, "Undated");
});
