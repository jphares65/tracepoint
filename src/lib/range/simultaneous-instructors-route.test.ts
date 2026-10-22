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
// refusal it loads the server copy and replays its own changes, holding back
// any change the server would refuse (UX-RB-5, review H1). After any other
// refusal it does the same once per server version.
async function recover(device: { base: any; baseUpdatedAt: string | null; local: any; conflicts: any[] }) {
  const { recoverWorkspace } = await import("./workspace-device-copy.ts");
  const { previewRangeWorkspaceMutation } = await import("./workspace-mutation.ts");
  const permissions: string[] = (globalThis as any).__rangeAccess.context.permissions;
  const serverRaw = stored!.workspace;
  const server = strip(serverRaw);
  const recovered = recoverWorkspace({
    base: device.base,
    local: device.local,
    server,
    conflicts: device.conflicts,
    accept: (workspace) => {
      const decision = previewRangeWorkspaceMutation({ existingWorkspace: serverRaw, nextWorkspace: workspace, canManage: permissions.includes("manage_range_days"), canScore: true });
      return decision.ok ? { ok: true as const } : { ok: false as const, error: decision.error };
    },
  });
  device.conflicts = recovered.conflicts;
  device.local = recovered.workspace;
  device.base = server;
  device.baseUpdatedAt = stored!.updated_at;
}

async function saveLikeDevice(device: { base: any; baseUpdatedAt: string | null; local: any; conflicts: any[] }) {
  let response = await put(device.local, device.baseUpdatedAt);
  if (response.status === 409 && response.body.code === "stale_workspace") {
    await recover(device);
    response = await put(device.local, device.baseUpdatedAt);
  } else if ([400, 403, 409].includes(response.status)) {
    await recover(device);
  }
  if (response.status === 200) { device.base = device.local; device.baseUpdatedAt = response.body.updatedAt; }
  return response;
}

async function startDay(initial: any = plan()) {
  stored = null;
  const access = (globalThis as any).__rangeAccess.context;
  access.permissions = ["manage_range_days"];
  const created = await put(initial, null);
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

// Review of 65e1cd9 (scratchpad proofs P1-P8): each case below failed before.
const fresh = (officer: string, score: number) => ({ id: `result-${crypto.randomUUID()}`, rangeDayId: "day-1", drillId: "drill-1", runNumber: 1, officerId: officer, score, completed: true, passed: score >= 40 });

test("review H3: the same officer and run scored fresh on two devices is one result and a conflict, never two scores", async () => {
  const [one, two] = await startDay();
  one.local = { ...one.local, results: [fresh("officer-a", 46)] };
  two.local = { ...two.local, results: [fresh("officer-a", 31)] };
  assert.equal((await saveLikeDevice(one)).status, 200);
  assert.equal((await saveLikeDevice(two)).status, 200);
  assert.deepEqual(stored!.workspace.results.map((item: any) => [item.officerId, item.score]), [["officer-a", 46]]);
  assert.deepEqual(two.conflicts.map((conflict) => [conflict.local.score, conflict.server.score]), [[31, 46]]);
  assert.equal(two.conflicts[0].local.id, stored!.workspace.results[0].id, "this device's value is held under the saved result's id");
});

test("review H1: a score for a day another device finalized is held back with the reason; the device keeps saving", async () => {
  const twoDays = { ...plan(), rangeDays: [...plan().rangeDays, { id: "day-2", departmentId: department, status: "In Progress" }], rangeRoster: [...plan().rangeRoster, { id: "roster-c", rangeDayId: "day-2", officerId: "officer-c" }] };
  const [lead, line] = await startDay(twoDays);
  const access = (globalThis as any).__rangeAccess.context;
  access.permissions = ["manage_range_days"];
  lead.local = { ...lead.local, rangeDays: lead.local.rangeDays.map((day: any) => (day.id === "day-1" ? { ...day, status: "Completed" } : day)) };
  assert.equal((await saveLikeDevice(lead)).status, 200);
  access.permissions = ["score_range_days"];
  line.local = { ...line.local, results: [fresh("officer-a", 44)] };
  assert.equal((await saveLikeDevice(line)).status, 200, "the recovered save no longer carries the refused score");
  assert.deepEqual(stored!.workspace.results, []);
  assert.equal(line.conflicts.length, 1);
  assert.equal(line.conflicts[0].local.score, 44, "the typed score is kept for the instructor");
  assert.match(line.conflicts[0].reason, /cannot be changed/);
  line.local = { ...line.local, rangeRoster: line.local.rangeRoster.map((entry: any) => (entry.id === "roster-c" ? { ...entry, attended: true } : entry)) };
  assert.equal((await saveLikeDevice(line)).status, 200, "unrelated work still saves");
  assert.equal(stored!.workspace.rangeRoster.find((entry: any) => entry.id === "roster-c").attended, true);
});

test("review H1: the same walk-up added by two scorers is one roster entry, not a permanent 403", async () => {
  const open = { ...plan(), rangeDays: [{ ...plan().rangeDays[0], attendanceMode: "Open / Rolling Attendance" }], rangeRoster: [] };
  const [one, two] = await startDay(open);
  const walkUp = () => ({ id: `roster-${crypto.randomUUID()}`, rangeDayId: "day-1", officerId: "officer-z", attended: true, attendanceTime: "08:05" });
  one.local = { ...one.local, rangeRoster: [walkUp()] };
  two.local = { ...two.local, rangeRoster: [walkUp()] };
  assert.equal((await saveLikeDevice(one)).status, 200);
  assert.equal((await saveLikeDevice(two)).status, 200);
  assert.equal(stored!.workspace.rangeRoster.length, 1);
  assert.deepEqual(two.conflicts, []);
});

test("review H1: a refusal the merge did not foresee is isolated after one reload; later saves go through", async () => {
  const start = { ...plan(), results: [result("officer-a", 40)] };
  const [device] = await startDay(start);
  // This device removed a saved score (the server never allows that) and scored officer B.
  device.local = { ...device.local, results: [result("officer-b", 45)] };
  const refused = await saveLikeDevice(device);
  assert.equal(refused.status, 409);
  assert.deepEqual(device.conflicts.map((conflict) => [conflict.id, conflict.local]), [["result-officer-a", null]]);
  assert.equal((await saveLikeDevice(device)).status, 200);
  assert.deepEqual(stored!.workspace.results.map((item: any) => item.officerId), ["officer-a", "officer-b"]);
});
