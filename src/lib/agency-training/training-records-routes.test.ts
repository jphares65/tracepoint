/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client double */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import { isoToZonedLocal } from "./event-time.ts";

// B7 (TRN-02/03/04/11/12/18/29/30): the route handlers run unchanged against an
// in-memory data client; only the session resolver and the server-only marker
// are replaced (as in training-record-visibility-routes.test.ts). The server
// process runs in UTC, as the deployed container does.
process.env.TZ = "UTC";
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
const denied = (error: string, status = 403) => Response.json({ error }, { status });
stub(require.resolve("server-only"), {});
stub(require.resolve("../tracepoint/server-access.ts"), {
  resolveServerAccess: async () => (globalThis as any).__trainingRecordsAccess,
  accessFailureResponse: () => denied("denied"),
  hasAnyServerPermission: (context: any, codes: readonly string[]) => context.permissions.includes("administer_department") || codes.some((code) => context.permissions.includes(code)),
  permissionDeniedResponse: (error: string) => denied(error),
  hasServerFeature: (context: any, feature: string) => context.enabledFeatures.includes(feature),
  requireServerFeature: (context: any, feature: string, label: string) => context.enabledFeatures.includes(feature) ? null : denied(`${label} disabled`),
});

type Row = Record<string, any>;
let sequence = 0;
function createDb(tables: Record<string, Row[]>) {
  function from(table: string) {
    tables[table] ??= [];
    const filters: ((row: Row) => boolean)[] = [];
    let op = "select"; let payload: any = null; let single = false;
    const builder: any = {
      select() { return builder; },
      eq(column: string, value: any) { filters.push((row) => String(row[column]) === String(value)); return builder; },
      in(column: string, values: any[]) { filters.push((row) => values.includes(row[column])); return builder; },
      is(column: string, value: any) { filters.push((row) => (row[column] ?? null) === value); return builder; },
      order() { return builder; },
      maybeSingle() { single = true; return builder; },
      single() { single = true; return builder; },
      insert(value: any) { op = "insert"; payload = value; return builder; },
      update(value: any) { op = "update"; payload = value; return builder; },
      delete() { op = "delete"; return builder; },
      upsert(value: any, options: { onConflict: string }) { op = "upsert"; payload = { rows: value, keys: options.onConflict.split(",") }; return builder; },
      then(resolve: any, reject: any) { return Promise.resolve(run()).then(resolve, reject); },
    };
    function run() {
      const rows = tables[table];
      if (op === "insert") {
        const inserted = (Array.isArray(payload) ? payload : [payload]).map((value) => ({ id: `${table}-${++sequence}`, ...value }));
        rows.push(...inserted);
        return { data: single ? { ...inserted[0] } : inserted.map((row) => ({ ...row })), error: null };
      }
      if (op === "upsert") {
        for (const value of payload.rows) {
          const found = rows.find((row) => payload.keys.every((key: string) => row[key] === value[key]));
          if (found) Object.assign(found, value); else rows.push({ id: `${table}-${++sequence}`, ...value });
        }
        return { data: null, error: null };
      }
      const matched = rows.filter((row) => filters.every((filter) => filter(row)));
      if (op === "update") matched.forEach((row) => Object.assign(row, payload));
      if (op === "delete") tables[table] = rows.filter((row) => !matched.includes(row));
      const data = matched.map((row) => structuredClone(row));
      return { data: single ? data[0] ?? null : data, error: null };
    }
    return builder;
  }
  return { from, tables, rpc: async () => ({ data: null, error: null }) };
}

const D = "dept-a";
const manager = "manager", officer = "officer-1", other = "officer-2", separated = "officer-3", newcomer = "officer-4";
const TIME = "2026-10-01T12:00:00.000Z";
const tables = (timezone = "America/Los_Angeles"): Record<string, Row[]> => ({
  departments: [{ id: D, name: "Dept A", timezone }],
  department_memberships: [
    ...[manager, officer, other, newcomer].map((user_id) => ({ department_id: D, user_id, is_active: true })),
    { department_id: D, user_id: separated, is_active: false },
    { department_id: "dept-b", user_id: "foreign", is_active: true },
  ],
  profiles: [],
  certification_types: [
    { id: "type-cpr", department_id: D, name: "CPR", is_active: true, expiration_required: true, issuing_organization: null },
    { id: "type-foreign", department_id: "dept-b", name: "CPR", is_active: true },
  ],
  agency_training_courses: [{ id: "course-1", department_id: D, canonical_title: "CPR", certification_type_id: "type-cpr" }, { id: "course-foreign", department_id: "dept-b" }],
  agency_training_events: [{ id: "event-1", department_id: D, title: "CPR", status: "in_progress", starts_at: "2026-10-25T01:00:00.000Z", ends_at: null, default_hours: 4, course_id: null, certification_type_id: null }],
  agency_training_event_instructors: [],
  agency_training_attendees: [
    { id: "a-1", department_id: D, event_id: "event-1", user_id: officer, attendance_status: "present", outcome_status: "passed", hours_completed: 4, score_text: "95", result_notes: null, remedial_notes: null, recorded_by_user_id: "instructor", recorded_at: TIME, created_by_user_id: "instructor", updated_by_user_id: "instructor", updated_at: TIME },
    { id: "a-3", department_id: D, event_id: "event-1", user_id: separated, attendance_status: "present", outcome_status: "pending", hours_completed: null, score_text: null, result_notes: null, remedial_notes: null, recorded_by_user_id: "instructor", recorded_at: TIME, created_by_user_id: "instructor", updated_by_user_id: "instructor", updated_at: TIME },
    { id: "a-2", department_id: D, event_id: "event-1", user_id: other, attendance_status: "assigned", outcome_status: "pending", hours_completed: null, score_text: null, result_notes: null, remedial_notes: null, recorded_by_user_id: null, recorded_at: null, created_by_user_id: "instructor", updated_by_user_id: "instructor", updated_at: TIME },
  ],
  training_certifications: [
    { id: "cert-manual", department_id: D, user_id: officer, certification_type_id: "type-cpr", issue_date: "2025-01-10", expiration_date: "2027-01-10", is_active: true, source_training_event_id: null },
    { id: "cert-closeout", department_id: D, user_id: officer, certification_type_id: "type-cpr", issue_date: "2026-10-24", expiration_date: "2028-10-23", is_active: true, source_training_event_id: "event-1" },
  ],
});
// The same roster with officer-3 still active (for tests not about TRN-11).
const noted = separated;
const activeOnly = () => { const value = tables(); value.department_memberships.find((row) => row.user_id === separated)!.is_active = true; return value; };
const signIn = (db: any, userId = manager, permissions = ["manage_training", "manage_certifications"]) => {
  (globalThis as any).__trainingRecordsAccess = { ok: true, context: { admin: db, db, departmentId: D, departmentName: "Dept A", userId, fullName: "Manager", user: { id: userId }, permissions, roleCodes: [], enabledFeatures: ["certifications"], isSuperAdmin: false, isSupportMode: false } };
};
const params = (value: Row) => ({ params: Promise.resolve(value) as any });

async function load() {
  const { NextRequest } = await import("next/server");
  const request = (url: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost${url}`, body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return {
    request,
    events: await import("../../app/api/agency-training/events/route.ts"),
    event: await import("../../app/api/agency-training/events/[eventId]/route.ts"),
    roster: await import("../../app/api/agency-training/events/[eventId]/roster/route.ts"),
    requirements: await import("../../app/api/agency-training/requirements/route.ts"),
    certifications: await import("../../app/api/training/certifications/route.ts"),
    certification: await import("../../app/api/training/certifications/[certificationId]/route.ts"),
  };
}

const rosterRow = (row: Row) => ({ userId: row.user_id, attendanceStatus: row.attendance_status, outcomeStatus: row.outcome_status, hoursCompleted: row.hours_completed, scoreText: row.score_text ?? "", resultNotes: row.result_notes ?? "", remedialNotes: row.remedial_notes ?? "" });

test("TRN-02: event times are department wall time and survive repeated saves (several zones, across DST)", async () => {
  const { events, event, request } = await load();
  const cases: Array<[string, string, string]> = [
    ["America/Los_Angeles", "2026-10-24T18:00", "2026-10-25T01:00:00.000Z"],
    ["America/New_York", "2026-11-01T01:30", "2026-11-01T05:30:00.000Z"], // repeated hour: first occurrence (EDT)
    ["America/New_York", "2026-03-08T12:00", "2026-03-08T16:00:00.000Z"], // spring-forward day
    ["America/Chicago", "2026-03-07T23:00", "2026-03-08T05:00:00.000Z"], // CST, the night before the change
    ["Asia/Kolkata", "2026-10-24T18:00", "2026-10-24T12:30:00.000Z"],
    ["Pacific/Honolulu", "2026-12-31T23:59", "2027-01-01T09:59:00.000Z"],
    ["UTC", "2026-01-01T00:00", "2026-01-01T00:00:00.000Z"],
  ];
  for (const [zone, typed, instant] of cases) {
    const db = createDb(tables(zone)); signIn(db);
    const created = await events.POST(request("/api/agency-training/events", "POST", { title: "CPR", startsAt: typed, endsAt: "", addCurrentUserAsInstructor: false }));
    assert.equal(created.status, 201, zone);
    const stored = db.tables.agency_training_events.at(-1)!;
    assert.equal(stored.starts_at, instant, `${zone} create`);
    const listed = await (await events.GET()).json();
    assert.equal(listed.timeZone, zone);
    // The editor redisplays in the department zone and re-sends what it shows.
    for (let save = 1; save <= 3; save += 1) {
      const shown = isoToZonedLocal(stored.starts_at, listed.timeZone);
      assert.equal(shown, typed, `${zone} save ${save}`);
      const patched = await event.PATCH(request(`/api/agency-training/events/${stored.id}`, "PATCH", { title: "CPR", startsAt: shown, endsAt: "" }), params({ eventId: stored.id }));
      assert.equal(patched.status, 200, zone);
      assert.equal(stored.starts_at, instant, `${zone} save ${save}`);
    }
  }
  // A time skipped by the spring-forward change settles after one save.
  const db = createDb(tables("America/New_York")); signIn(db);
  await events.POST(request("/api/agency-training/events", "POST", { title: "CPR", startsAt: "2026-03-08T02:30", addCurrentUserAsInstructor: false }));
  const gap = db.tables.agency_training_events.at(-1)!;
  assert.equal(isoToZonedLocal(gap.starts_at, "America/New_York"), "2026-03-08T03:30");
  await event.PATCH(request(`/api/agency-training/events/${gap.id}`, "PATCH", { startsAt: "2026-03-08T03:30" }), params({ eventId: gap.id }));
  assert.equal(isoToZonedLocal(gap.starts_at, "America/New_York"), "2026-03-08T03:30");
  // Values that carry a zone are instants, as before (API clients sending ISO).
  await event.PATCH(request(`/api/agency-training/events/${gap.id}`, "PATCH", { startsAt: "2026-10-25T01:00:00.000Z" }), params({ eventId: gap.id }));
  assert.equal(gap.starts_at, "2026-10-25T01:00:00.000Z");
});

test("TRN-03: the editor sends the course's certification type and the event API stores it on create and edit", async () => {
  const editor = await readFile("src/app/components/AgencyTrainingEventEditor.tsx", "utf8");
  assert.match(editor, /certificationTypeId: course\.certificationTypeId/);
  assert.equal((editor.match(/certificationTypeId: draft\.certificationTypeId/g) ?? []).length, 2, "event and library-course bodies");
  assert.match(editor, /certificationTypeId: event\.certificationTypeId/);
  const { events, event, request } = await load();
  const db = createDb(tables()); signIn(db);
  assert.equal((await events.POST(request("/api/agency-training/events", "POST", { title: "CPR", courseId: "course-1", certificationTypeId: "type-cpr", startsAt: "2026-10-24T18:00", addCurrentUserAsInstructor: false }))).status, 201);
  assert.equal(db.tables.agency_training_events.at(-1)!.certification_type_id, "type-cpr");
  const patch = (body: Row) => event.PATCH(request("/api/agency-training/events/event-1", "PATCH", body), params({ eventId: "event-1" }));
  assert.equal((await patch({ certificationTypeId: "type-cpr", certificationValidDays: "730" })).status, 200);
  assert.equal(db.tables.agency_training_events[0].certification_type_id, "type-cpr");
  assert.equal(db.tables.agency_training_events[0].certification_valid_days, 730);
  assert.equal((await patch({ certificationTypeId: "type-foreign" })).status, 400);
  assert.equal(db.tables.agency_training_events[0].certification_type_id, "type-cpr");
});

test("TRN-04: attendance is kept as entered and Completed/Passed without Present is refused", async () => {
  const { roster, request } = await load();
  const db = createDb(activeOnly()); signIn(db);
  const put = (attendees: Row[]) => roster.PUT(request("/api/agency-training/events/event-1/roster", "PUT", { attendees }), params({ eventId: "event-1" }));
  const rows = db.tables.agency_training_attendees.map(rosterRow);
  for (const attendance of ["no_show", "excused", "assigned"]) {
    const response = await put(rows.map((row) => row.userId === other ? { ...row, attendanceStatus: attendance, outcomeStatus: "completed" } : row));
    assert.equal(response.status, 400, attendance);
    assert.match((await response.json()).error, /Present/);
  }
  assert.equal(db.tables.agency_training_attendees.find((row) => row.user_id === other)!.outcome_status, "pending");
  const saved = await put(rows.map((row) => row.userId === other ? { ...row, attendanceStatus: "no_show", outcomeStatus: "incomplete" } : row));
  assert.equal(saved.status, 200);
  const stored = db.tables.agency_training_attendees.find((row) => row.user_id === other)!;
  assert.deepEqual([stored.attendance_status, stored.outcome_status], ["no_show", "incomplete"]);
  const board = await readFile("src/app/components/AgencyTrainingRosterBoard.tsx", "utf8");
  assert.doesNotMatch(board, /:\s*"present"/, "the board must not rewrite attendance");
});

test("TRN-11: a roster with a since-deactivated attendee saves, and attended rows are never deleted", async () => {
  const { roster, request } = await load();
  const db = createDb(tables()); signIn(db);
  const put = (attendees: Row[]) => roster.PUT(request("/api/agency-training/events/event-1/roster", "PUT", { attendees }), params({ eventId: "event-1" }));
  const rows = db.tables.agency_training_attendees.map(rosterRow);
  const withSeparated = await put(rows.map((row) => row.userId === separated ? { ...row, outcomeStatus: "incomplete" } : row));
  assert.equal(withSeparated.status, 200);
  assert.equal(db.tables.agency_training_attendees.find((row) => row.user_id === separated)!.outcome_status, "incomplete");
  // A new addition must still be an active member.
  assert.equal((await put([...db.tables.agency_training_attendees.map(rosterRow), { userId: "foreign", attendanceStatus: "assigned", outcomeStatus: "pending" }])).status, 400);
  assert.equal((await put([...db.tables.agency_training_attendees.map(rosterRow), { userId: newcomer, attendanceStatus: "assigned", outcomeStatus: "pending" }])).status, 200);
  // Removing a row with recorded attendance or results is refused; the row stays.
  const removeSeparated = await put(db.tables.agency_training_attendees.filter((row) => row.user_id !== separated).map(rosterRow));
  assert.equal(removeSeparated.status, 409);
  assert.ok(db.tables.agency_training_attendees.some((row) => row.user_id === separated));
  // An unrecorded (assigned/pending) row can still be removed.
  assert.equal((await put(db.tables.agency_training_attendees.filter((row) => row.user_id !== newcomer).map(rosterRow))).status, 200);
  assert.ok(!db.tables.agency_training_attendees.some((row) => row.user_id === newcomer));
});

test("TRN-12: a roster save stamps recorded_by/at only on rows whose attendance or outcome changed", async () => {
  const { roster, request } = await load();
  const db = createDb(activeOnly()); signIn(db);
  const put = (attendees: Row[]) => roster.PUT(request("/api/agency-training/events/event-1/roster", "PUT", { attendees }), params({ eventId: "event-1" }));
  const before = structuredClone(db.tables.agency_training_attendees);
  const rows = before.map(rosterRow);
  assert.equal((await put(rows.map((row) => row.userId === other ? { ...row, attendanceStatus: "present", outcomeStatus: "passed" } : row.userId === noted ? { ...row, resultNotes: "left early" } : row))).status, 200);
  const after = (userId: string) => db.tables.agency_training_attendees.find((row) => row.user_id === userId)!;
  const original = (userId: string) => before.find((row) => row.user_id === userId)!;
  assert.deepEqual(after(officer), original(officer), "unchanged row is not rewritten");
  assert.deepEqual([after(other).recorded_by_user_id, after(other).created_by_user_id], [manager, "instructor"]);
  assert.notEqual(after(other).recorded_at, null);
  assert.deepEqual([after(noted).recorded_by_user_id, after(noted).recorded_at, after(noted).created_by_user_id, after(noted).updated_by_user_id], ["instructor", TIME, "instructor", manager]);
});

test("TRN-18: Complete Event is blocked while the roster has unsaved edits", async () => {
  const board = await readFile("src/app/components/AgencyTrainingRosterBoard.tsx", "utf8");
  const panel = await readFile("src/app/components/AgencyTrainingCloseoutPanel.tsx", "utf8");
  assert.match(board, /hasUnsavedChanges=\{dirty\}/);
  for (const handler of ["function updateRow", "function addSelectedPersonnel"]) { const start = board.indexOf(handler); assert.match(board.slice(start, board.indexOf("\n  }\n", start)), /setDirty\(true\)/, handler); }
  const closeout = panel.slice(panel.indexOf("async function closeout"));
  assert.ok(closeout.indexOf("hasUnsavedChanges") > -1 && closeout.indexOf("hasUnsavedChanges") < closeout.indexOf("/closeout"), "checked before the closeout POST");
});

test("TRN-30: event, roster and requirement APIs refuse invalid state with 400", async () => {
  const { events, event, roster, requirements, request } = await load();
  const db = createDb(tables()); signIn(db);
  const create = (body: Row) => events.POST(request("/api/agency-training/events", "POST", { title: "CPR", startsAt: "2026-10-24T18:00", addCurrentUserAsInstructor: false, ...body }));
  assert.equal((await create({ status: "completed" })).status, 400);
  assert.equal((await create({ courseId: "course-foreign" })).status, 400);
  assert.equal((await create({ endsAt: "not a time" })).status, 400);
  const patch = (body: Row) => event.PATCH(request("/api/agency-training/events/event-1", "PATCH", body), params({ eventId: "event-1" }));
  for (const body of [{ title: "" }, { status: "completed" }, { status: "bogus" }, { startsAt: "" }, { endsAt: "2026-10-24T17:00" }, { courseId: "course-foreign" }]) {
    assert.equal((await patch(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(db.tables.agency_training_events[0].title, "CPR");
  assert.equal(db.tables.agency_training_events[0].status, "in_progress");
  const put = await roster.PUT(request("/api/agency-training/events/event-1/roster", "PUT", { attendees: [{ userId: officer, attendanceStatus: "here", outcomeStatus: "pending" }] }), params({ eventId: "event-1" }));
  assert.equal(put.status, 400);
  const requirement = (body: Row) => requirements.POST(request("/api/agency-training/requirements", "POST", { courseId: "course-1", requirementName: "Annual", intervalValue: 12, intervalUnit: "months", ...body }));
  assert.equal((await requirement({ intervalValue: null })).status, 400);
  assert.equal((await requirement({ scopeType: "everyone" })).status, 400);
  assert.equal((await requirement({ intervalUnit: "fortnights" })).status, 400);
  assert.equal((await requirement({ courseId: "course-foreign" })).status, 400);
  assert.equal((await requirement({ scopeType: "selected_members", selectedMemberIds: ["foreign"] })).status, 400);
  assert.equal((await requirement({ dueBasis: "fixed_annual_date", intervalValue: null, fixedMonth: 1, fixedDay: 1 })).status, 201);
  assert.equal(db.tables.agency_training_requirements.at(-1)!.interval_unit, null);
  assert.equal((await requirement({})).status, 201);
});

test("TRN-29: certification dates are validated and history fields cannot be rewritten", async () => {
  const { certifications, certification, request } = await load();
  const db = createDb(tables()); signIn(db);
  const create = (body: Row) => certifications.POST(request("/api/training/certifications", "POST", { userId: officer, certificationTypeId: "type-cpr", issueDate: "2026-01-01", expirationDate: "2028-01-01", ...body }));
  assert.equal((await create({ issueDate: "2026-02-30" })).status, 400);
  assert.equal((await create({ expirationDate: "01/02/2028" })).status, 400);
  assert.equal((await create({ expirationDate: "2025-12-31" })).status, 400);
  assert.equal((await create({ documentUrl: "javascript:alert(1)" })).status, 400);
  assert.equal((await create({ documentUrl: "https://example.test/card.pdf" })).status, 201);
  const edit = (id: string, body: Row) => certification.PATCH(request(`/api/training/certifications/${id}`, "PATCH", { userId: officer, certificationTypeId: "type-cpr", issueDate: "2025-01-10", expirationDate: "2027-01-10", ...body }), params({ certificationId: id }));
  assert.equal((await edit("cert-manual", { userId: other })).status, 400);
  assert.equal(db.tables.training_certifications[0].user_id, officer);
  assert.equal((await edit("cert-manual", { expirationDate: "2024-01-01" })).status, 400);
  assert.equal((await edit("cert-manual", { credentialNumber: "C-1" })).status, 200);
  assert.equal((await edit("cert-closeout", { issueDate: "2026-10-25", expirationDate: "2028-10-23" })).status, 400);
  assert.equal((await edit("cert-closeout", { issueDate: "2026-10-24", expirationDate: "2028-10-23", notes: "wallet card" })).status, 200);
});
