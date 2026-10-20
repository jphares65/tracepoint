/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client double */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// RNG-07 / RNG-12 / RNG-14: the route handlers run unchanged against an
// in-memory data client; only the session resolver, the object store and the
// server-only marker are replaced (as in training-record-visibility-routes.test.ts).
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
const denied = (error: string, status = 403) => Response.json({ error }, { status });
stub(require.resolve("server-only"), {});
stub(require.resolve("../tracepoint/server-access.ts"), {
  resolveServerAccess: async () => (globalThis as any).__instructorLineAccess,
  accessFailureResponse: () => denied("denied"),
  hasAnyServerPermission: (context: any, codes: readonly string[]) => context.permissions.includes("administer_department") || codes.some((code) => context.permissions.includes(code)),
  permissionDeniedResponse: (error: string) => denied(error),
  hasServerFeature: (context: any, feature: string) => context.enabledFeatures.includes(feature),
  featureDisabledResponse: (label: string) => denied(`${label} disabled`),
  requireServerFeature: (context: any, feature: string, label: string) => context.enabledFeatures.includes(feature) ? null : denied(`${label} disabled`),
});
stub(require.resolve("../storage/object-store.ts"), {
  createObjectStore: () => ({
    uploadQualificationEvidence: async (input: any) => ({ path: `${input.departmentId}/qualification/${input.recordId}/${input.objectId}`, error: null }),
    removeAttachment: async () => ({ error: null }),
    createAttachmentView: async (path: string) => ({ signedUrl: `https://storage.invalid/${path}`, error: null }),
    createAttachmentDownload: async (path: string) => ({ signedUrl: `https://storage.invalid/${path}`, error: null }),
  }),
  attachmentPathFromMetadata: (path: string) => path,
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
const IMPORTED = "6f1c2b9e-0d7a-4c55-9a43-1b2c3d4e5f60";
const UPDATED_AT = "2026-10-20T12:00:00.000Z";
const workspace = () => ({
  rangeDays: [
    { id: "day-1", departmentId: D, status: "In Progress", title: "Scheduled" },
    { id: "day-2", departmentId: D, status: "In Progress", title: "Open line", attendanceMode: "Open / Rolling Attendance" },
  ],
  drillLibrary: [],
  rangeDayDrills: [{ id: "drill-1", rangeDayId: "day-1", name: "Handgun Qualification", maxScore: 60 }],
  rangeRoster: [{ id: "roster-1", rangeDayId: "day-1", officerId: "officer-1", assignedFirearmIds: [], attended: false }],
  results: [{ id: "result-1", rangeDayId: "day-1", drillId: "drill-1", runNumber: 1, officerId: "officer-1", score: 55, passed: true, completed: true }],
  malfunctions: [],
});
const tables = (): Record<string, Row[]> => ({
  pilot_range_workspaces: [{ department_id: D, workspace: workspace(), updated_at: UPDATED_AT, updated_by_user_id: "manager" }],
  department_qualification_standards: [], department_qualification_standard_components: [],
  qualification_results: [{ id: IMPORTED, department_id: D, officer_user_id: "officer-1", passed: true, record_origin: "historical_import" }],
  attachments: [], audit_events: [],
});
const signIn = (db: any, userId: string, permissions: string[]) => {
  (globalThis as any).__instructorLineAccess = { ok: true, context: { admin: db, db, departmentId: D, userId, user: { id: userId }, permissions, roleCodes: [], enabledFeatures: ["range_training", "qualifications"], isSuperAdmin: false, isSupportMode: false } };
};
const params = (value: Row) => ({ params: Promise.resolve(value) as any });

async function load() {
  const { NextRequest } = await import("next/server");
  const json = (url: string, method: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const upload = (resultId: string) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "target.jpg", { type: "image/jpeg" }));
    return new NextRequest(`http://localhost/api/qualifications/${resultId}/evidence`, { method: "POST", body: form });
  };
  return {
    json, upload,
    rangeWorkspace: await import("../../app/api/pilot/range-workspace/route.ts"),
    mobileRangeWorkspace: await import("../../app/api/mobile/range-workspace/route.ts"),
    evidence: await import("../../app/api/qualifications/[resultId]/evidence/route.ts"),
    download: await import("../../app/api/attachments/[attachmentId]/download/route.ts"),
  };
}

test("RNG-07: an instructor marks attendance and adds a walk-up through both range workspace PUT routes", async () => {
  const { rangeWorkspace, mobileRangeWorkspace, json } = await load();
  for (const [label, put, url] of [["web", rangeWorkspace.PUT, "/api/pilot/range-workspace"], ["mobile", mobileRangeWorkspace.PUT, "/api/mobile/range-workspace"]] as const) {
    const db = createDb(tables());
    signIn(db, "instructor", ["score_range_days"]);
    const next = workspace();
    next.rangeRoster = [
      { ...next.rangeRoster[0], attended: true },
      { id: "roster-2", rangeDayId: "day-2", officerId: "officer-2", assignedFirearmIds: ["firearm-2"], attended: true, attendanceTime: "2026-10-20T13:00:00.000Z", notes: "Added during open attendance." } as any,
    ];
    const response = await put(json(url, "PUT", { workspace: next }) as any);
    assert.equal(response.status, 200, label);
    assert.deepEqual(db.tables.pilot_range_workspaces[0].workspace.rangeRoster, next.rangeRoster, label);

    // Planning stays with range management.
    const planning = { ...next, rangeDays: next.rangeDays.map((day) => ({ ...day, title: "Renamed" })) };
    assert.equal((await put(json(url, "PUT", { workspace: planning }) as any)).status, 403, label);
    const removal = { ...next, rangeRoster: [] };
    assert.equal((await put(json(url, "PUT", { workspace: removal }) as any)).status, 403, label);
  }
});

test("RNG-14: an impossible score is refused with a clear message by both PUT routes", async () => {
  const { rangeWorkspace, mobileRangeWorkspace, json } = await load();
  for (const [put, url] of [[rangeWorkspace.PUT, "/api/pilot/range-workspace"], [mobileRangeWorkspace.PUT, "/api/mobile/range-workspace"]] as const) {
    const db = createDb(tables());
    signIn(db, "instructor", ["score_range_days"]);
    const next = workspace();
    next.results = [{ ...next.results[0], score: 75 }];
    const response = await put(json(url, "PUT", { workspace: next }) as any);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Score 75 for Handgun Qualification is above the maximum of 60\./);
    assert.equal(db.tables.pilot_range_workspaces[0].workspace.results[0].score, 55);
  }
});

test("RNG-12: instructors upload target evidence keyed to the stable result id, including imported results", async () => {
  const { evidence, upload } = await load();
  const db = createDb(tables());
  signIn(db, "instructor", ["score_range_days"]);
  const response = await evidence.POST(upload("result-1"), params({ resultId: "result-1" }));
  assert.equal(response.status, 201);
  assert.equal(db.tables.attachments[0].entity_key, "result-1");
  assert.equal(db.tables.audit_events[0].new_value.qualification_result_id, "result-1");

  const imported = await evidence.POST(upload(IMPORTED), params({ resultId: IMPORTED }));
  assert.equal(imported.status, 201);
  assert.equal(db.tables.attachments[1].entity_key, IMPORTED);

  signIn(db, "officer-1", []);
  assert.equal((await evidence.POST(upload("result-1"), params({ resultId: "result-1" }))).status, 403);
  signIn(db, "instructor", ["score_range_days"]);
  assert.equal((await evidence.POST(upload("missing"), params({ resultId: "missing" }))).status, 404);
  const otherAgency = "0b7c2d1e-0000-4000-8000-000000000000";
  db.tables.qualification_results.push({ id: otherAgency, department_id: "dept-b", officer_user_id: "officer-1" });
  assert.equal((await evidence.POST(upload(otherAgency), params({ resultId: otherAgency }))).status, 404);
});

test("RNG-12: the officer of an imported result can list and download its evidence", async () => {
  const { evidence, download } = await load();
  const { NextRequest } = await import("next/server");
  const db = createDb(tables());
  db.tables.attachments.push({ id: "file-1", department_id: D, entity_type: "qualification", entity_key: IMPORTED, archived_at: null, file_name: "target.jpg", storage_path: "dept-a/q/file-1", uploaded_by_user_id: "instructor" });
  const list = async (userId: string) => { signIn(db, userId, []); return evidence.GET(new NextRequest(`http://localhost/api/qualifications/${IMPORTED}/evidence`), params({ resultId: IMPORTED })); };
  const own = await list("officer-1");
  assert.equal(own.status, 200);
  assert.deepEqual((await own.json()).attachments.map((row: Row) => row.id), ["file-1"]);
  assert.equal((await list("officer-2")).status, 403);

  const fetchFile = async (userId: string) => { signIn(db, userId, []); return download.GET(new NextRequest("http://localhost/api/attachments/file-1/download"), params({ attachmentId: "file-1" })); };
  assert.equal((await fetchFile("officer-1")).status, 307);
  assert.equal((await fetchFile("officer-2")).status, 403);
});
