/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client double */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// UX-RB-5: two instructor devices save the same range workspace through the
// real PUT route (its version check and authorization). Only the session
// resolver and the database are doubles.
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
stub(require.resolve("server-only"), {});
stub(require.resolve("../tracepoint/server-access.ts"), {
  resolveServerAccess: async () => (globalThis as any).__rangeAccess,
  accessFailureResponse: () => Response.json({ error: "denied" }, { status: 403 }),
  featureDisabledResponse: () => Response.json({ error: "disabled" }, { status: 403 }),
  hasAnyServerPermission: (context: any, permissions: string[]) => permissions.some((permission) => context.permissions.includes(permission)),
  hasServerFeature: () => true,
  requireServerFeature: () => null,
});

const department = "agency-a";
let stored: { department_id: string; workspace: any; updated_at: string } | null = null;

const admin = {
  from() {
    let op: "select" | "update" | "insert" = "select";
    let payload: any = null;
    const filters: [string, any][] = [];
    const builder: any = {
      select: () => builder,
      update: (value: any) => { op = "update"; payload = value; return builder; },
      insert: (value: any) => { op = "insert"; payload = value; return builder; },
      eq: (column: string, value: any) => { filters.push([column, value]); return builder; },
      maybeSingle: async () => {
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

(globalThis as any).__rangeAccess = { ok: true, context: { admin, user: { id: "instructor" }, userId: "instructor", departmentId: department, permissions: ["score_range_days"], enabledFeatures: ["range_training"] } };

const plan = () => ({
  rangeDays: [{ id: "day-1", departmentId: department, status: "In Progress", packetStatus: "Needs Setup" }],
  drillLibrary: [],
  rangeDayDrills: [{ id: "drill-1", rangeDayId: "day-1", name: "Handgun Qualification", maxScore: 50 }],
  rangeRoster: [{ id: "roster-a", rangeDayId: "day-1", officerId: "officer-a" }, { id: "roster-b", rangeDayId: "day-1", officerId: "officer-b" }],
  results: [] as any[],
  malfunctions: [],
});
const result = (officer: string, score: number) => ({ id: `result-${officer}`, rangeDayId: "day-1", drillId: "drill-1", runNumber: 1, officerId: officer, score, completed: true, passed: score >= 40 });
const strip = (workspace: any) => ({ rangeDays: workspace.rangeDays, drillLibrary: workspace.drillLibrary, rangeDayDrills: workspace.rangeDayDrills, rangeRoster: workspace.rangeRoster, results: workspace.results, malfunctions: workspace.malfunctions });

async function put(workspace: unknown, baseUpdatedAt: string | null) {
  const { PUT } = await import("../../app/api/pilot/range-workspace/route.ts");
  const response = await PUT(new Request("http://x/api/pilot/range-workspace", { method: "PUT", body: JSON.stringify({ workspace, baseUpdatedAt }) }) as any);
  return { status: response.status, body: await response.json() as any };
}

// A device as the page now behaves: base = what it last synced; on a stale
// refusal it loads the server copy and replays its own changes (UX-RB-5).
async function saveLikeDevice(device: { base: any; baseUpdatedAt: string | null; local: any; conflicts: any[] }) {
  const { mergeRangeWorkspace } = await import("./workspace-merge.ts");
  let response = await put(device.local, device.baseUpdatedAt);
  if (response.status === 409 && response.body.code === "stale_workspace") {
    const server = strip(stored!.workspace);
    const merge = mergeRangeWorkspace(device.base, device.local, server);
    device.conflicts.push(...merge.conflicts);
    device.local = merge.merged;
    device.base = server;
    device.baseUpdatedAt = stored!.updated_at;
    response = await put(device.local, device.baseUpdatedAt);
  }
  if (response.status === 200) { device.base = device.local; device.baseUpdatedAt = response.body.updatedAt; }
  return response;
}

async function startDay() {
  stored = null;
  const access = (globalThis as any).__rangeAccess.context;
  access.permissions = ["manage_range_days"];
  const created = await put(plan(), null);
  access.permissions = ["score_range_days"];
  assert.equal(created.status, 200);
  const load = () => ({ base: strip(stored!.workspace), baseUpdatedAt: stored!.updated_at, local: strip(stored!.workspace), conflicts: [] as any[] });
  return [load(), load()];
}

test("UX-RB-5: two instructors scoring different officers at the same time keep both scores", async () => {
  const [one, two] = await startDay();
  one.local = { ...one.local, results: [result("officer-a", 46)] };
  two.local = { ...two.local, results: [result("officer-b", 38)] };
  assert.equal((await saveLikeDevice(one)).status, 200);
  const second = await saveLikeDevice(two);
  assert.equal(second.status, 200);
  assert.deepEqual(stored!.workspace.results.map((item: any) => [item.officerId, item.score]), [["officer-a", 46], ["officer-b", 38]]);
  assert.deepEqual(two.conflicts, []);
});

test("UX-RB-5 defect (RC 5b6cc00): without recovery the second device's save is refused and its score never reaches the server", async () => {
  const [one, two] = await startDay();
  one.local = { ...one.local, results: [result("officer-a", 46)] };
  two.local = { ...two.local, results: [result("officer-b", 38)] };
  assert.equal((await put(one.local, one.baseUpdatedAt)).status, 200);
  const refused = await put(two.local, two.baseUpdatedAt);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "stale_workspace");
  // The RC page's only remedy was window.location.reload(), which reloads from the server.
  assert.deepEqual(stored!.workspace.results.map((item: any) => item.officerId), ["officer-a"]);
});

test("UX-RB-5: the same officer scored on both devices is kept as a conflict, then resolved without loss", async () => {
  const [one, two] = await startDay();
  one.local = { ...one.local, results: [result("officer-a", 46)] };
  two.local = { ...two.local, results: [result("officer-a", 44)] };
  assert.equal((await saveLikeDevice(one)).status, 200);
  assert.equal((await saveLikeDevice(two)).status, 200);
  assert.equal(stored!.workspace.results[0].score, 46);
  assert.deepEqual(two.conflicts.map((conflict) => [conflict.id, conflict.local.score, conflict.server.score]), [["result-officer-a", 44, 46]]);
  // The instructor chooses this device's value; it is saved like any edit.
  const { applyConflictChoice } = await import("./workspace-merge.ts");
  two.local = applyConflictChoice(two.local, two.conflicts[0]);
  assert.equal((await saveLikeDevice(two)).status, 200);
  assert.equal(stored!.workspace.results[0].score, 44);
  // The corrected score keeps its revision history on the server (B3).
  assert.ok(Array.isArray(stored!.workspace.resultRevisions));
});
