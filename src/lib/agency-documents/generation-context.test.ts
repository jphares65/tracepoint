import assert from "node:assert/strict";
import test from "node:test";
import { GenerationContextError, loadGenerationSources, todayInZone, type GenerationDatabase } from "./generation-context";

const DEPT = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
const OFFICER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", OFFICER2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", INSTRUCTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FIREARM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", ARCHIVED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", QUAL = "ffffffff-ffff-4fff-8fff-ffffffffffff", QUAL2 = "99999999-9999-4999-8999-999999999999";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {
  departments: [{ id: DEPT, name: "Lakeview Township Police Department", short_name: "Lakeview PD", timezone: "America/New_York" }, { id: OTHER, name: "Other PD", short_name: null, timezone: "America/Chicago" }],
  department_memberships: [
    { department_id: DEPT, user_id: OFFICER, badge_number: "4471", rank_title: "Patrol Officer", is_active: true, profiles: { full_name: "Jordan A. Rivera", email: "jr@example.test" } },
    { department_id: DEPT, user_id: OFFICER2, badge_number: "5000", rank_title: "Detective", is_active: true, profiles: { full_name: "Avery Chen", email: null } },
    { department_id: DEPT, user_id: INSTRUCTOR, badge_number: "1", rank_title: "Sergeant", is_active: true, profiles: { full_name: "Taylor Brooks", email: null } },
    { department_id: OTHER, user_id: "12121212-1212-4121-8121-121212121212", badge_number: "9", rank_title: "Chief", is_active: true, profiles: { full_name: "Not Ours", email: null } },
  ],
  firearms: [
    { id: FIREARM, department_id: DEPT, make: "Example Arms", model: "EA-19", serial_number: "EXA123456", caliber: "9mm", asset_number: null, firearm_type: "handgun", archived_at: null },
    { id: ARCHIVED, department_id: DEPT, make: "Old", model: "Gone", serial_number: "OLD1", caliber: "38", asset_number: null, firearm_type: "handgun", archived_at: "2025-01-01" },
  ],
  firearm_assignments: [{ department_id: DEPT, firearm_id: FIREARM, assigned_to_user_id: OFFICER, returned_at: null }],
  qualification_results: [
    { id: QUAL, department_id: DEPT, officer_user_id: OFFICER, qualification_date: "2026-03-14", score: "287.00", passed: true, qualification_course_id: "abababab-abab-4bab-8bab-abababababab", instructor_user_id: INSTRUCTOR, historical_course_name: null, historical_instructor_name: null },
    { id: QUAL2, department_id: DEPT, officer_user_id: OFFICER2, qualification_date: "2025-03-14", score: 250, passed: false, qualification_course_id: null, instructor_user_id: null, historical_course_name: "Legacy Night Course", historical_instructor_name: "R. Former" },
  ],
  qualification_courses: [{ id: "abababab-abab-4bab-8bab-abababababab", department_id: DEPT, name: "Day Handgun Course" }],
};

function fakeDb(): GenerationDatabase {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return query; },
        is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return query; },
        maybeSingle: async () => {
          const rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
          return rows.length > 1 ? { data: null, error: { message: "multiple rows" } } : { data: rows[0] ?? null, error: null };
        },
      };
      return query;
    },
  };
}

const preparer = { fullName: "Casey Morgan", badgeNumber: "1102", rankTitle: "Sergeant" };

test("loads the selected officer, firearm and qualification with real course and instructor names", async () => {
  const sources = await loadGenerationSources(fakeDb(), DEPT, { personId: OFFICER, firearmId: FIREARM, qualificationId: QUAL }, preparer, { today: "2026-10-18", reportYear: 2026 });
  assert.equal(sources.person?.fullName, "Jordan A. Rivera");
  assert.equal(sources.firearm?.serialNumber, "EXA123456");
  assert.equal(sources.firearm?.assignedOfficerName, "Jordan A. Rivera");
  assert.equal(sources.qualification?.courseName, "Day Handgun Course");
  assert.equal(sources.qualification?.instructorName, "Taylor Brooks");
  assert.equal(sources.agency?.name, "Lakeview Township Police Department");
  assert.equal(sources.preparer?.fullName, "Casey Morgan");
});

test("historical qualification text is used only when no linked course or instructor exists", async () => {
  const sources = await loadGenerationSources(fakeDb(), DEPT, { personId: OFFICER2, qualificationId: QUAL2 }, preparer, { today: "2026-10-18" });
  assert.equal(sources.qualification?.courseName, "Legacy Night Course");
  assert.equal(sources.qualification?.instructorName, "R. Former");
  assert.equal(sources.qualification?.passed, false);
});

test("records from another agency, archived firearms, malformed ids and mismatched qualifications are refused", async () => {
  await assert.rejects(loadGenerationSources(fakeDb(), OTHER, { personId: OFFICER }, preparer, { today: "2026-10-18" }), GenerationContextError);
  await assert.rejects(loadGenerationSources(fakeDb(), DEPT, { firearmId: ARCHIVED }, preparer, { today: "2026-10-18" }), /firearm is not available/);
  await assert.rejects(loadGenerationSources(fakeDb(), DEPT, { personId: "not-a-uuid" }, preparer, { today: "2026-10-18" }), /not an active member/);
  await assert.rejects(loadGenerationSources(fakeDb(), DEPT, { personId: OFFICER, qualificationId: QUAL2 }, preparer, { today: "2026-10-18" }), /different officer/);
});

test("an ambiguous firearm assignment is reported as unassigned instead of guessed", async () => {
  tables.firearm_assignments.push({ department_id: DEPT, firearm_id: FIREARM, assigned_to_user_id: OFFICER2, returned_at: null });
  try {
    const sources = await loadGenerationSources(fakeDb(), DEPT, { firearmId: FIREARM }, preparer, { today: "2026-10-18" });
    assert.equal(sources.firearm?.assignedOfficerName, null);
  } finally {
    tables.firearm_assignments.pop();
  }
});

test("the generation date follows the agency's time zone", () => {
  const lateNight = new Date("2026-10-19T02:30:00Z"); // 10:30 PM on Oct 18 in New York
  assert.equal(todayInZone("America/New_York", lateNight), "2026-10-18");
  assert.equal(todayInZone("UTC", lateNight), "2026-10-19");
});
