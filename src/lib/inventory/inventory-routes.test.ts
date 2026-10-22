/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory data client double */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Handler-level tests for the Inventory record fixes: one request, one record
// (D-65), the holder named rather than identified (D-62), an inventory-scoped
// recipient list (D-63) and consumable issue with a reason (D-70). The route
// handlers run unchanged against an in-memory client; only the session
// resolver is replaced (route modules load as CommonJS under tsx).
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
stub(require.resolve("server-only"), {});
stub(require.resolve("../tracepoint/server-access.ts"), {
  resolveServerAccess: async () => (globalThis as any).__inventoryAccess,
  accessFailureResponse: () => Response.json({ error: "denied" }, { status: 401 }),
  hasAnyServerPermission: (context: any, permissions: string[]) => permissions.some((permission) => context.permissions.includes(permission)),
});

const checkouts = require("../../app/api/inventory/checkouts/route.ts");
const returns = require("../../app/api/inventory/checkouts/[checkoutId]/returns/route.ts");
const transactions = require("../../app/api/inventory/transactions/route.ts");

const directory = [
  { recipient_type: "officer", recipient_id: "u-1", label: "Dana Cole", detail: "Sgt · 101", is_active: true },
  { recipient_type: "officer", recipient_id: "u-2", label: "Sam Ruiz", detail: null, is_active: false },
  { recipient_type: "vehicle", recipient_id: "v-1", label: "12", detail: "Ford · Explorer", is_active: true },
  { recipient_type: "vehicle", recipient_id: "v-2", label: "7", detail: null, is_active: false },
];

function setup(permissions: string[], rpcResult: (name: string, args: any) => { data: any; error: any } = () => ({ data: [{ id: "row-1" }], error: null })) {
  const calls: { name: string; args: any }[] = [];
  const rows: Record<string, any[]> = {
    inventory_checkouts: [
      { id: "c-1", department_id: "d-1", recipient_type: "officer", recipient_user_id: "u-1", recipient_unit: null, recipient_vehicle_id: null, quantity: 2, closed_at: null, due_at: null, checked_out_at: "2026-10-22T10:00:00Z", inventory_checkout_returns: [] },
      { id: "c-2", department_id: "d-1", recipient_type: "officer", recipient_user_id: "u-2", recipient_unit: null, recipient_vehicle_id: null, quantity: 1, closed_at: null, due_at: null, checked_out_at: "2026-10-22T09:00:00Z", inventory_checkout_returns: [] },
      { id: "c-3", department_id: "d-1", recipient_type: "vehicle", recipient_user_id: null, recipient_unit: null, recipient_vehicle_id: "v-1", quantity: 1, closed_at: null, due_at: null, checked_out_at: "2026-10-22T08:00:00Z", inventory_checkout_returns: [{ quantity: 0.5 }] },
      { id: "c-4", department_id: "d-1", recipient_type: "unit", recipient_user_id: null, recipient_unit: "K9", recipient_vehicle_id: null, quantity: 1, closed_at: null, due_at: null, checked_out_at: "2026-10-22T07:00:00Z", inventory_checkout_returns: [] },
    ],
  };
  const db = {
    from(table: string) {
      const filters: ((row: any) => boolean)[] = [];
      const builder: any = {
        select() { return builder; },
        eq(column: string, value: any) { filters.push((row) => row[column] === value); return builder; },
        is(column: string, value: any) { filters.push((row) => (row[column] ?? null) === value); return builder; },
        order() { return builder; },
        then(resolve: any, reject: any) { return Promise.resolve({ data: (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))), error: null }).then(resolve, reject); },
      };
      return builder;
    },
    rpc(name: string, args: any) {
      calls.push({ name, args });
      if (name === "inventory_recipient_directory") return Promise.resolve({ data: directory, error: null });
      return Promise.resolve(rpcResult(name, args));
    },
  };
  (globalThis as any).__inventoryAccess = { ok: true, context: { db, admin: db, departmentId: "d-1", user: { id: "actor" }, userId: "actor", permissions } };
  return calls;
}
const post = (body: unknown) => new Request("http://local/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as any;
const get = (url = "http://local/api/inventory/checkouts") => Object.assign(new Request(url), { nextUrl: new URL(url) }) as any;
const key = "6f0c3a52-1c1e-4a8e-9a55-0d7f4b8f2a10";
const checkoutBody = { itemId: "i-1", locationId: "l-1", recipientType: "officer", recipientUserId: "u-1", quantity: 2, idempotencyKey: key };

test("D-65: a checkout carries its request key to the database, so a resubmission is one checkout", async () => {
  const calls = setup(["adjust_inventory"]);
  const response = await checkouts.POST(post(checkoutBody));
  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "checkout_inventory");
  assert.equal(calls[0].args.p_idempotency_key, key);
});

test("D-65: a malformed request key is refused before anything is recorded", async () => {
  const calls = setup(["adjust_inventory"]);
  assert.equal((await checkouts.POST(post({ ...checkoutBody, idempotencyKey: "twice" }))).status, 400);
  assert.equal((await returns.POST(post({ quantity: 1, idempotencyKey: "twice" }), { params: Promise.resolve({ checkoutId: "c-1" }) })).status, 400);
  assert.equal((await transactions.POST(post({ itemId: "i-1", transactionType: "receive", quantity: 1, destinationLocationId: "l-1", idempotencyKey: 7 }))).status, 400);
  assert.equal(calls.length, 0);
});

test("D-65: a key reused for a different checkout is a 409 that says nothing was recorded", async () => {
  setup(["adjust_inventory"], () => ({ data: null, error: { message: "PostgreSQL data operation failed.", code: "23505" } }));
  const response = await checkouts.POST(post(checkoutBody));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /nothing was recorded/);
});

test("D-65: a return and a stock movement carry their request keys", async () => {
  const calls = setup(["adjust_inventory"]);
  assert.equal((await returns.POST(post({ quantity: 1, idempotencyKey: key }), { params: Promise.resolve({ checkoutId: "c-1" }) })).status, 200);
  assert.equal((await transactions.POST(post({ itemId: "i-1", transactionType: "transfer", quantity: 1, sourceLocationId: "l-1", destinationLocationId: "l-2", idempotencyKey: key }))).status, 201);
  assert.deepEqual(calls.map((call) => [call.name, call.args.p_idempotency_key]), [["return_inventory_checkout", key], ["record_inventory_transaction", key]]);
});

test("D-65: pages loaded before this release still record (no key)", async () => {
  const calls = setup(["adjust_inventory"]);
  const { idempotencyKey: _omitted, ...legacy } = checkoutBody;
  void _omitted;
  assert.equal((await checkouts.POST(post(legacy))).status, 201);
  assert.equal(calls[0].args.p_idempotency_key, null);
});

test("D-70: an issue or count correction (adjust) requires a reason; a negative quantity lowers on-hand", async () => {
  const calls = setup(["adjust_inventory"]);
  const refused = await transactions.POST(post({ itemId: "i-1", transactionType: "adjust", quantity: -3, sourceLocationId: "l-1", idempotencyKey: key }));
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /reason/i);
  assert.equal(calls.length, 0);
  const issued = await transactions.POST(post({ itemId: "i-1", transactionType: "adjust", quantity: -3, sourceLocationId: "l-1", reason: "Issued to patrol", idempotencyKey: key }));
  assert.equal(issued.status, 201);
  assert.equal(calls[0].args.p_quantity, -3);
  assert.equal(calls[0].args.p_reason, "Issued to patrol");
  assert.equal(calls[0].args.p_destination_location_id, null);
});

test("D-62: outstanding checkouts name the holder, never an identifier", async () => {
  setup(["view_inventory"]);
  const response = await checkouts.GET(get());
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.checkouts.map((row: any) => [row.id, row.recipient_label, row.outstanding_quantity]), [
    ["c-1", "Dana Cole", 2],
    ["c-2", "Sam Ruiz (inactive)", 1],
    ["c-3", "Unit 12", 0.5],
    ["c-4", "K9", 1],
  ]);
});

test("D-63: an inventory adjuster gets every active member and vehicle as a recipient", async () => {
  const recipients = require("../../app/api/inventory/recipients/route.ts");
  setup(["adjust_inventory"]);
  const response = await recipients.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    officers: [{ id: "u-1", label: "Dana Cole", detail: "Sgt · 101" }],
    vehicles: [{ id: "v-1", label: "12", detail: "Ford · Explorer" }],
  });
  setup(["view_inventory"]);
  assert.equal((await recipients.GET()).status, 403);
});
