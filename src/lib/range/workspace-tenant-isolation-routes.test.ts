/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client double */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Historical agency workspace JSON can hold records stamped with another
// agency. The web and mobile range-workspace routes must never return them,
// never let a client change them, and keep them byte for byte when the
// agency's own records are saved (web PUT and mobile PUT alike). Only the
// session resolver and the database are doubles; the route handlers are real.
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
stub(require.resolve("server-only"), {});
stub(require.resolve("../tracepoint/server-access.ts"), {
  resolveServerAccess: async () => (globalThis as any).__tenantAccess,
  accessFailureResponse: () => Response.json({ error: "denied" }, { status: 403 }),
  featureDisabledResponse: () => Response.json({ error: "disabled" }, { status: 403 }),
  hasAnyServerPermission: (context: any, permissions: string[]) => permissions.some((permission) => context.permissions.includes(permission)),
  hasServerFeature: () => true,
  requireServerFeature: () => null,
});
stub(require.resolve("./read-repository.ts"), {
  createRangeReadRepository: () => ({
    getWorkspace: async () => ({ workspace: stored?.workspace ?? null, updatedAt: stored?.updated_at ?? null, updatedByUserId: null, qualificationStandards: [] }),
    getPersonnel: async () => ({ memberships: [], profiles: [] }),
  }),
});

const department = "agency-a";
const foreign = "agency-b";
let stored: { department_id: string; workspace: any; updated_at: string } | null = null;

const admin = {
  from(table: string) {
    let op: "select" | "update" | "insert" = "select";
    let payload: any = null;
    const filters: [string, any][] = [];
    const builder: any = {
      select: () => builder,
      update: (value: any) => { op = "update"; payload = value; return builder; },
      insert: (value: any) => { op = "insert"; payload = value; return builder; },
      eq: (column: string, value: any) => { filters.push([column, value]); return builder; },
      maybeSingle: async () => {
        if (table !== "pilot_range_workspaces") return { data: null, error: null };
        const matches = stored && filters.every(([column, value]) => (stored as any)[column] === value);
        if (op === "select") return { data: matches ? stored : null, error: null };
        if (op === "insert") { stored = { ...payload }; return { data: { department_id: department }, error: null }; }
        if (!matches) return { data: null, error: null };
        stored = { ...(stored as any), ...payload };
        return { data: { department_id: department }, error: null };
      },
    };
    return builder;
  },
};

(globalThis as any).__tenantAccess = { ok: true, context: { admin, user: { id: "instructor" }, userId: "instructor", departmentId: department, permissions: ["manage_range_days", "score_range_days"], enabledFeatures: ["range_training"] } };

// A stored workspace with one agency-A day and one legacy agency-B day.
const seeded = () => ({
  rangeDays: [
    { id: "day-a", departmentId: department, title: "A qualification", status: "In Progress" },
    { id: "day-b", departmentId: foreign, title: "B confidential day", status: "In Progress" },
  ],
  drillLibrary: [
    { id: "tmpl-a", departmentId: department, name: "A drill" },
    { id: "tmpl-b", departmentId: foreign, name: "B drill" },
  ],
  rangeDayDrills: [
    { id: "drill-a", rangeDayId: "day-a", name: "A drill", maxScore: 50 },
    { id: "drill-b", rangeDayId: "day-b", name: "B drill", maxScore: 50 },
  ],
  rangeRoster: [
    { id: "roster-a", rangeDayId: "day-a", officerId: "officer-a" },
    { id: "roster-b", rangeDayId: "day-b", officerId: "officer-b" },
  ],
  results: [{ id: "result-b", rangeDayId: "day-b", drillId: "drill-b", runNumber: 1, officerId: "officer-b", score: 44 }],
  malfunctions: [],
});
const seed = () => { stored = { department_id: department, workspace: seeded(), updated_at: "2026-10-22T10:00:00.000Z" }; };
const foreignRecords = (workspace: any) => JSON.stringify(workspace).match(/day-b|tmpl-b|drill-b|roster-b|result-b|B confidential/g) ?? [];

async function webGet() {
  const { GET } = await import("../../app/api/pilot/range-workspace/route.ts");
  const response = await GET();
  return { status: response.status, body: await response.json() as any };
}
async function mobileGet() {
  const { GET } = await import("../../app/api/mobile/range-workspace/route.ts");
  const response = await GET(new Request("http://x/api/mobile/range-workspace"));
  return { status: response.status, body: await response.json() as any };
}
async function put(route: "pilot" | "mobile", workspace: unknown, baseUpdatedAt: string | null) {
  const { PUT } = await import(`../../app/api/${route}/range-workspace/route.ts`);
  const response = await PUT(new Request(`http://x/api/${route}/range-workspace`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace, baseUpdatedAt }) }) as any);
  return { status: response.status, body: await response.json() as any };
}

test("web GET never returns another agency's range records", async () => {
  seed();
  const loaded = await webGet();
  assert.equal(loaded.status, 200);
  assert.deepEqual(foreignRecords(loaded.body.workspace), []);
  assert.deepEqual(loaded.body.workspace.rangeDays.map((day: any) => day.id), ["day-a"]);
  assert.deepEqual(loaded.body.workspace.rangeRoster.map((entry: any) => entry.id), ["roster-a"]);
});

test("mobile GET never returns another agency's range records", async () => {
  seed();
  const loaded = await mobileGet();
  assert.equal(loaded.status, 200);
  assert.deepEqual(foreignRecords(loaded.body.workspace), []);
  assert.deepEqual(loaded.body.workspace.rangeDays.map((day: any) => day.id), ["day-a"]);
});

for (const [route, load] of [["pilot", webGet], ["mobile", mobileGet]] as const) {
  test(`${route}: saving the agency's own records keeps the other agency's records exactly`, async () => {
    seed();
    const before = JSON.parse(JSON.stringify(stored!.workspace));
    const loaded = await load();
    const workspace = loaded.body.workspace;
    workspace.rangeRoster = [...workspace.rangeRoster, { id: "roster-a2", rangeDayId: "day-a", officerId: "officer-c" }];
    const saved = await put(route, workspace, loaded.body.updatedAt);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    for (const name of ["rangeDays", "drillLibrary", "rangeDayDrills", "rangeRoster", "results"]) {
      const keptForeign = before[name].filter((item: any) => /-b$/.test(item.id));
      for (const item of keptForeign) assert.deepEqual(stored!.workspace[name].find((candidate: any) => candidate.id === item.id), item, `${name} ${item.id}`);
    }
    assert.ok(stored!.workspace.rangeRoster.some((entry: any) => entry.id === "roster-a2"));
  });

  test(`${route}: a client cannot change another agency's record`, async () => {
    seed();
    const workspace = JSON.parse(JSON.stringify(stored!.workspace));
    workspace.rangeDays[1] = { ...workspace.rangeDays[1], title: "renamed by agency A" };
    const saved = await put(route, workspace, stored!.updated_at);
    assert.equal(saved.status, 403);
    assert.equal(stored!.workspace.rangeDays[1].title, "B confidential day");
  });

  test(`${route}: a client cannot add a score under another agency's range day`, async () => {
    seed();
    const workspace = JSON.parse(JSON.stringify(stored!.workspace));
    workspace.results.push({ id: "result-injected", rangeDayId: "day-b", drillId: "drill-b", runNumber: 2, officerId: "officer-b", score: 10 });
    const saved = await put(route, workspace, stored!.updated_at);
    assert.equal(saved.status, 403);
    assert.ok(!stored!.workspace.results.some((item: any) => item.id === "result-injected"));
  });
}
