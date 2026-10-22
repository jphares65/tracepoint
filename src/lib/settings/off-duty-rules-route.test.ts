/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client double */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// SV-29: handler-level tests of /api/settings/off-duty-rules. The route runs
// unchanged against an in-memory department_rules table; only the session
// resolver and the server-only marker are replaced (route modules load as
// CommonJS under tsx, so the stubs go in the require cache).
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
stub(require.resolve("server-only"), {});
const DEPARTMENT = "eeeeeeee-0000-4000-8000-00000000000a", OTHER = "eeeeeeee-0000-4000-8000-00000000000b";
let context: any;
stub(require.resolve("../tracepoint/server-access.ts"), {
  resolveServerAccess: async () => ({ ok: true, context }),
  accessFailureResponse: () => Response.json({ error: "denied" }, { status: 401 }),
  requireServerFeature: (ctx: any, code: string) => ctx.enabledFeatures.includes(code) ? null : Response.json({ error: "disabled" }, { status: 403 }),
  hasAnyServerPermission: (ctx: any, permissions: string[]) => ctx.permissions.includes("administer_department") || permissions.some((p) => ctx.permissions.includes(p)),
});

type Row = Record<string, any>;
function table(rows: Row[]) {
  return {
    from(name: string) {
      assert.equal(name, "department_rules");
      const filters: [string, unknown][] = [];
      let payload: Row | null = null, columns = "*", single = false;
      const builder: any = {
        select(selection: string) { columns = selection; return builder; },
        update(value: Row) { payload = value; return builder; },
        eq(column: string, value: unknown) { filters.push([column, value]); return builder; },
        single() { single = true; return builder; },
        maybeSingle() { return builder; },
        then(resolve: any, reject: any) {
          const matched = rows.filter((row) => filters.every(([column, value]) => row[column] === value));
          if (payload) for (const row of matched) Object.assign(row, payload);
          const pick = (row: Row) => columns === "*" ? { ...row } : Object.fromEntries(columns.split(",").map((column) => [column, row[column]]));
          const result = single && matched.length !== 1
            ? { data: null, error: { message: "PostgreSQL single-row result was not unique." } }
            : { data: matched[0] ? pick(matched[0]) : null, error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function setup(permissions = ["administer_department"]) {
  const rows: Row[] = [
    { department_id: DEPARTMENT, require_off_duty_inspection: true, require_off_duty_qualification: true, off_duty_renewal_days: 365, inspection_interval_days: 180, inspection_due_soon_days: 30, battery_check_interval_days: 90, spring_cycle_start: "04-01" },
    { department_id: OTHER, require_off_duty_inspection: true, require_off_duty_qualification: true, off_duty_renewal_days: 365, inspection_interval_days: 180, inspection_due_soon_days: 30 },
  ];
  context = { departmentId: DEPARTMENT, permissions, enabledFeatures: ["off_duty"], admin: table(rows) };
  return rows;
}

async function route() {
  const { NextRequest } = await import("next/server");
  const handlers = await import("../../app/api/settings/off-duty-rules/route.ts");
  const patch = (body: unknown) => handlers.PATCH(new NextRequest("http://localhost/api/settings/off-duty-rules", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } })) as Promise<Response>;
  return { GET: () => handlers.GET() as Promise<Response>, patch };
}

const change = { requireInspection: false, requireQualification: false, renewalDays: 730, inspectionIntervalDays: 120, inspectionDueSoonDays: 14 };

test("SV-29: PATCH stores every off-duty rule for the active agency and returns the stored values", async () => {
  const rows = setup();
  const { GET, patch } = await route();
  const response = await patch(change);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).rules, change);
  assert.equal(rows[0].require_off_duty_inspection, false);
  assert.equal(rows[0].require_off_duty_qualification, false);
  assert.equal(rows[0].off_duty_renewal_days, 730);
  assert.equal(rows[0].inspection_interval_days, 120);
  assert.equal(rows[0].inspection_due_soon_days, 14);
  // Only the off-duty columns change, and only for this agency.
  assert.equal(rows[0].battery_check_interval_days, 90);
  assert.equal(rows[0].spring_cycle_start, "04-01");
  assert.equal(rows[1].off_duty_renewal_days, 365);
  // A fresh read returns what was saved.
  assert.deepEqual((await (await GET()).json()).rules, change);
});

test("SV-29: an invalid or unauthorised PATCH changes nothing and says why", async () => {
  let rows = setup();
  const { patch } = await route();
  const invalid = await patch({ ...change, inspectionDueSoonDays: 200 });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /Inspection warning must be zero or greater and less than the inspection validity period\./);
  assert.equal(rows[0].off_duty_renewal_days, 365);

  rows = setup(["manage_users"]);
  const refused = await patch(change);
  assert.equal(refused.status, 403);
  assert.match((await refused.json()).error, /Department administration permission is required/);
  assert.equal(rows[0].require_off_duty_inspection, true);
});

test("SV-29: a PATCH that stores nothing is reported as a failure, not a success", async () => {
  const rows = setup();
  rows.splice(0, 1);
  const { patch } = await route();
  const response = await patch(change);
  assert.equal(response.status, 500);
  assert.ok((await response.json()).error);
});
