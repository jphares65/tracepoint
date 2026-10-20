/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client double */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// TRN-26 / RNG-28: the route handlers run unchanged against an in-memory data
// client; only the session resolver and the server-only marker are replaced
// (as in fleet-authorization-decisions.test.ts).
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
const denied = (error: string, status = 403) => Response.json({ error }, { status });
stub(require.resolve("server-only"), {});
stub(require.resolve("./server-access.ts"), {
  resolveServerAccess: async () => (globalThis as any).__trainingVisibilityAccess,
  accessFailureResponse: () => denied("denied"),
  hasAnyServerPermission: (context: any, codes: readonly string[]) => context.permissions.includes("administer_department") || codes.some((code) => context.permissions.includes(code)),
  permissionDeniedResponse: (error: string) => denied(error),
  hasServerFeature: (context: any, feature: string) => context.enabledFeatures.includes(feature),
  featureDisabledResponse: (label: string) => denied(`${label} disabled`),
  requireServerFeature: (context: any, feature: string, label: string) => context.enabledFeatures.includes(feature) ? null : denied(`${label} disabled`),
});

type Row = Record<string, any>;
function createDb(tables: Record<string, Row[]>) {
  function from(table: string) {
    tables[table] ??= [];
    const filters: ((row: Row) => boolean)[] = [];
    let op = "select"; let payload: any = null; let single = false;
    const builder: any = {
      select() { return builder; },
      eq(column: string, value: any) { filters.push((row) => String(row[column]) === String(value)); return builder; },
      neq(column: string, value: any) { filters.push((row) => row[column] !== value); return builder; },
      in(column: string, values: any[]) { filters.push((row) => values.includes(row[column])); return builder; },
      is(column: string, value: any) { filters.push((row) => (row[column] ?? null) === value); return builder; },
      order() { return builder; },
      maybeSingle() { single = true; return builder; },
      single() { single = true; return builder; },
      insert(value: any) { op = "insert"; payload = value; return builder; },
      update(value: any) { op = "update"; payload = value; return builder; },
      then(resolve: any, reject: any) { return Promise.resolve(run()).then(resolve, reject); },
    };
    function run() {
      const rows = tables[table];
      if (op === "insert") { rows.push({ ...payload }); return { data: { ...payload }, error: null }; }
      const matched = rows.filter((row) => filters.every((filter) => filter(row)));
      if (op === "update") matched.forEach((row) => Object.assign(row, payload));
      const data = matched.map((row) => structuredClone(row));
      return { data: single ? data[0] ?? null : data, error: null };
    }
    return builder;
  }
  return { from, tables };
}

const D = "dept-a";
const officer = "officer-1"; const other = "officer-2";
const workspace = () => ({
  rangeDays: [{ id: "day-1", departmentId: D, status: "In Progress", title: "Spring" }],
  drillLibrary: [], rangeDayDrills: [{ id: "drill-1", rangeDayId: "day-1" }],
  rangeRoster: [{ id: "roster-1", rangeDayId: "day-1", officerId: officer }, { id: "roster-2", rangeDayId: "day-1", officerId: other, notes: "late again" }],
  results: [
    { id: "result-1", rangeDayId: "day-1", drillId: "drill-1", runNumber: 1, officerId: officer, score: 95, passed: true },
    { id: "result-2", rangeDayId: "day-1", drillId: "drill-1", runNumber: 1, officerId: other, score: 61, passed: false, notes: "remedial: grip" },
  ],
  malfunctions: [{ id: "m-2", rangeDayId: "day-1", officerId: other, firearmId: "f2" }],
});
const UPDATED_AT = "2026-10-20T12:00:00.000Z";
const tables = (): Record<string, Row[]> => ({
  pilot_range_workspaces: [{ department_id: D, workspace: workspace(), updated_at: UPDATED_AT, updated_by_user_id: "scorer" }],
  department_qualification_standards: [], department_qualification_standard_components: [],
  qualification_results: [
    { id: "q-1", department_id: D, officer_user_id: officer, score: 95, passed: true, record_origin: "historical_import" },
    { id: "q-2", department_id: D, officer_user_id: other, score: 71, passed: false, notes: "remedial", record_origin: "historical_import" },
  ],
  training_certifications: [
    { id: "c-1", department_id: D, user_id: officer, certification_title: "Own cert", is_active: true },
    { id: "c-2", department_id: D, user_id: other, certification_title: "Private cert", is_active: true },
  ],
  department_memberships: [officer, other, "manager"].map((user_id) => ({ department_id: D, user_id, is_active: true })),
  profiles: [{ id: officer, full_name: "Officer One" }, { id: other, full_name: "Officer Two" }],
  certification_types: [], department_certification_requirements: [],
  agency_training_events: [{ id: "event-1", department_id: D, title: "In-service", status: "completed", agency_training_attendees: [
    { id: "a-1", user_id: officer, outcome_status: "passed" }, { id: "a-2", user_id: other, outcome_status: "failed" }] }],
  agency_training_attendees: [
    { id: "a-1", department_id: D, event_id: "event-1", user_id: officer, outcome_status: "passed", score_text: "95", remedial_notes: null },
    { id: "a-2", department_id: D, event_id: "event-1", user_id: other, outcome_status: "failed", score_text: "61", remedial_notes: "retest grip" },
  ],
  agency_training_certificates: [
    { id: "cert-1", department_id: D, event_id: "event-1", user_id: officer, certificate_number: "1" },
    { id: "cert-2", department_id: D, event_id: "event-1", user_id: other, certificate_number: "2" },
  ],
  attachments: [{ id: "file-1", department_id: D, entity_type: "qualification", entity_key: "result-2", archived_at: null, file_name: "target.jpg" }],
});
const FEATURES = ["range_training", "qualifications", "certifications"];
const signIn = (db: any, userId: string, permissions: string[]) => {
  (globalThis as any).__trainingVisibilityAccess = { ok: true, context: { admin: db, db, departmentId: D, userId, user: { id: userId }, permissions, roleCodes: [], enabledFeatures: FEATURES, isSuperAdmin: false, isSupportMode: false } };
};
const params = (value: Row) => ({ params: Promise.resolve(value) as any });

async function load() {
  const { NextRequest } = await import("next/server");
  const request = (url: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost${url}`, body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return {
    request,
    rangeWorkspace: await import("../../app/api/pilot/range-workspace/route.ts"),
    mobileRangeWorkspace: await import("../../app/api/mobile/range-workspace/route.ts"),
    qualifications: await import("../../app/api/qualifications/route.ts"),
    evidence: await import("../../app/api/qualifications/[resultId]/evidence/route.ts"),
    certifications: await import("../../app/api/training/certifications/route.ts"),
    readiness: await import("../../app/api/readiness/certifications/route.ts"),
    events: await import("../../app/api/agency-training/events/route.ts"),
    roster: await import("../../app/api/agency-training/events/[eventId]/roster/route.ts"),
    files: await import("../../app/api/agency-training/events/[eventId]/files/route.ts"),
  };
}

test("range workspace GET returns only the officer's own rows; range and command roles get the department", async () => {
  const { rangeWorkspace } = await load();
  const read = async (userId: string, permissions: string[]) => { const db = createDb(tables()); signIn(db, userId, permissions); const response = await rangeWorkspace.GET(); return { status: response.status, body: await response.json() }; };
  const own = await read(officer, []);
  assert.equal(own.status, 200);
  assert.equal(own.body.recordScope, "own");
  assert.deepEqual(own.body.workspace.results.map((row: Row) => row.id), ["result-1"]);
  assert.deepEqual(own.body.workspace.rangeRoster.map((row: Row) => row.id), ["roster-1"]);
  assert.deepEqual(own.body.workspace.malfunctions, []);
  assert.deepEqual(own.body.workspace.rangeDays, workspace().rangeDays);
  assert.doesNotMatch(JSON.stringify(own.body), /officer-2|remedial|late again/);
  for (const permissions of [["score_range_days"], ["manage_range_days"], ["manage_qualifications"], ["manage_training"], ["view_analytics"], ["view_command_dashboard"], ["administer_department"]]) {
    const full = await read("staff", permissions);
    assert.equal(full.body.recordScope, "department", permissions[0]);
    assert.deepEqual(full.body.workspace, workspace(), permissions[0]);
  }
});

test("a filtered range workspace sent back as a PUT is refused and erases nothing", async () => {
  const { rangeWorkspace, request } = await load();
  const db = createDb(tables());
  signIn(db, officer, []);
  const loaded = await (await rangeWorkspace.GET()).json();
  const put = await rangeWorkspace.PUT(request("/api/pilot/range-workspace", "PUT", { workspace: loaded.workspace, baseUpdatedAt: loaded.updatedAt }));
  assert.equal(put.status, 403);
  assert.deepEqual(db.tables.pilot_range_workspaces[0].workspace, workspace());
  assert.equal(db.tables.pilot_range_workspaces[0].updated_at, UPDATED_AT);
  // A scorer receives the whole document, so their round trip keeps every row.
  signIn(db, "scorer", ["score_range_days"]);
  const scorerLoad = await (await rangeWorkspace.GET()).json();
  const scorerPut = await rangeWorkspace.PUT(request("/api/pilot/range-workspace", "PUT", { workspace: scorerLoad.workspace, baseUpdatedAt: scorerLoad.updatedAt }));
  assert.equal(scorerPut.status, 200);
  assert.deepEqual(db.tables.pilot_range_workspaces[0].workspace.results, workspace().results);
});

test("mobile live scoring stays limited to range permissions", async () => {
  const { mobileRangeWorkspace, request } = await load();
  signIn(createDb(tables()), officer, ["view_analytics"]);
  assert.equal((await mobileRangeWorkspace.GET(request("/api/mobile/range-workspace"))).status, 403);
  signIn(createDb(tables()), "scorer", ["score_range_days"]);
  const scorer = await mobileRangeWorkspace.GET(request("/api/mobile/range-workspace"));
  assert.equal(scorer.status, 200);
  assert.equal((await scorer.json()).workspace.results.length, 2);
});

test("qualification history: own results for officers, department for range and qualification roles", async () => {
  const { qualifications } = await load();
  const ids = async (userId: string, permissions: string[]) => { signIn(createDb(tables()), userId, permissions); return (await (await qualifications.GET()).json()).results.map((row: Row) => row.id); };
  assert.deepEqual(await ids(officer, []), ["q-1"]);
  assert.deepEqual(await ids(other, ["manage_certifications"]), ["q-2"]);
  assert.deepEqual(await ids("staff", ["manage_qualifications"]), ["q-1", "q-2"]);
  assert.deepEqual(await ids("staff", ["view_analytics"]), ["q-1", "q-2"]);
});

test("qualification evidence lists only for the result's officer or evidence roles", async () => {
  const { evidence, request } = await load();
  const status = async (userId: string, permissions: string[], resultId: string) => { signIn(createDb(tables()), userId, permissions); return (await evidence.GET(request(`/api/qualifications/${resultId}/evidence`), params({ resultId }))).status; };
  assert.equal(await status(officer, [], "result-2"), 403);
  assert.equal(await status(officer, ["manage_training"], "result-2"), 403);
  assert.equal(await status(other, [], "result-2"), 200);
  assert.equal(await status(officer, [], "result-1"), 200);
  assert.equal(await status("staff", ["score_range_days"], "result-2"), 200);
  assert.equal(await status("staff", [], "missing"), 404);
});

test("certifications: own credentials for officers, department for certification managers", async () => {
  const { certifications, readiness } = await load();
  const ids = async (userId: string, permissions: string[]) => { signIn(createDb(tables()), userId, permissions); const body = await (await certifications.GET()).json(); return { ids: body.certifications.map((row: Row) => row.id), members: body.members.length }; };
  assert.deepEqual(await ids(officer, []), { ids: ["c-1"], members: 3 });
  assert.deepEqual(await ids(officer, ["view_command_dashboard"]), { ids: ["c-1"], members: 3 });
  assert.deepEqual(await ids("staff", ["manage_certifications"]), { ids: ["c-1", "c-2"], members: 3 });
  signIn(createDb(tables()), officer, []);
  assert.equal((await readiness.GET()).status, 403);
});

test("agency training roster, certificates and counts: own rows unless training staff", async () => {
  const { events, roster, files, request } = await load();
  const rosterFor = async (userId: string, permissions: string[]) => { signIn(createDb(tables()), userId, permissions); return (await (await roster.GET(request("/api/agency-training/events/event-1/roster"), params({ eventId: "event-1" }))).json()); };
  const own = await rosterFor(officer, []);
  assert.deepEqual(own.attendees.map((row: Row) => row.id), ["a-1"]);
  assert.equal(own.members.length, 3);
  assert.doesNotMatch(JSON.stringify(own.attendees), /retest|61/);
  assert.deepEqual((await rosterFor(officer, ["view_command_dashboard"])).attendees.map((row: Row) => row.id), ["a-1"]);
  assert.deepEqual((await rosterFor("staff", ["manage_training"])).attendees.map((row: Row) => row.id), ["a-1", "a-2"]);

  const certificates = async (userId: string, permissions: string[]) => { signIn(createDb(tables()), userId, permissions); return (await (await files.GET(request("/api/agency-training/events/event-1/files"), params({ eventId: "event-1" }))).json()).certificates.map((row: Row) => row.id); };
  assert.deepEqual(await certificates(officer, []), ["cert-1"]);
  assert.deepEqual(await certificates("staff", ["manage_training"]), ["cert-1", "cert-2"]);

  const counts = async (userId: string, permissions: string[]) => { signIn(createDb(tables()), userId, permissions); const [event] = (await (await events.GET()).json()).events; return [event.attendeeCount, event.completedCount]; };
  assert.deepEqual(await counts(other, []), [1, 0]);
  assert.deepEqual(await counts("staff", ["manage_training"]), [2, 1]);
  assert.deepEqual(await counts("staff", ["view_command_dashboard"]), [2, 1]);
});
