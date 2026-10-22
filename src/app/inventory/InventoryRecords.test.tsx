/* eslint-disable @typescript-eslint/no-explicit-any -- module-cache stub */
import "@/lib/testing/dom";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, test } from "node:test";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import InventoryCheckoutForm from "./InventoryCheckoutForm.tsx";
import OutstandingCheckouts from "./OutstandingCheckouts.tsx";

// Inventory records: one tap is one record (D-65), the holder is named (D-62),
// recipients come from Inventory (D-63) and consumables can be issued (D-70).
const require = createRequire(import.meta.url);
require.cache[require.resolve("../components/TracePointShell.tsx")] = {
  id: "shell", filename: "shell", loaded: true,
  exports: { __esModule: true, default: ({ children }: { children: ReactNode }) => <>{children}</> },
} as any;
const InventoryPage = require("./page.tsx").default as () => ReactNode;

afterEach(cleanup);
// The page announces checkout changes with a DOM event; use the document's Event.
globalThis.Event = window.Event;

type Call = { url: string; method: string; body: any };
function serve(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const call = { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}
function deferred() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release };
}
const posts = (calls: Call[], fragment: string) => calls.filter((call) => call.method === "POST" && call.url.includes(fragment));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const items = [
  { id: "i-1", name: "Radios", category: "Comms", description: null, tracking_mode: "pooled", unit_of_measure: "each", sku: null, is_active: true },
  { id: "i-2", name: "Gloves", category: "Medical", description: null, tracking_mode: "consumable", unit_of_measure: "box", sku: null, is_active: true },
];
const locations = [{ id: "l-1", name: "Supply room", description: null, is_active: true }];
const balances = [
  { id: "b-1", inventory_item_id: "i-1", inventory_location_id: "l-1", on_hand_quantity: 10, inventory_items: items[0], inventory_locations: locations[0] },
  { id: "b-2", inventory_item_id: "i-2", inventory_location_id: "l-1", on_hand_quantity: 10, inventory_items: items[1], inventory_locations: locations[0] },
];
const recipients = { officers: [{ id: "u-1", label: "Dana Cole", detail: "Sgt · 101" }, { id: "u-2", label: "Lee Park" }], vehicles: [{ id: "v-1", label: "12" }] };

async function fillCheckout() {
  fireEvent.change(screen.getByLabelText("Pooled item"), { target: { value: "i-1" } });
  fireEvent.change(screen.getByLabelText("Source location"), { target: { value: "l-1" } });
  fireEvent.focus(screen.getByRole("combobox", { name: "Search Officer" }));
  fireEvent.click(await screen.findByRole("option", { name: /Lee Park/ }));
  fireEvent.change(screen.getByLabelText("Checkout quantity"), { target: { value: "2" } });
}

test("D-63: the checkout picker lists the agency's members from the Inventory recipient endpoint", async () => {
  const calls = serve(() => Response.json(recipients));
  render(<InventoryCheckoutForm items={items as any} locations={locations} balances={balances} onSuccess={async () => {}} />);
  fireEvent.focus(screen.getByRole("combobox", { name: "Search Officer" }));
  assert.ok(await screen.findByRole("option", { name: /Dana Cole/ }));
  assert.ok(screen.getByRole("option", { name: /Lee Park/ }));
  assert.deepEqual(calls.map((call) => call.url), ["/api/inventory/recipients"]);
});

test("D-65: a double-clicked checkout sends one request, and a retry after a lost connection reuses its key", async () => {
  const { gate, release } = deferred();
  let failNext = true;
  const calls = serve(async (call) => {
    if (call.url === "/api/inventory/recipients") return Response.json(recipients);
    if (failNext) { failNext = false; throw new TypeError("Failed to fetch"); }
    await gate;
    return Response.json({ checkout: {} }, { status: 201 });
  });
  render(<InventoryCheckoutForm items={items as any} locations={locations} balances={balances} onSuccess={async () => {}} />);
  await fillCheckout();
  const button = screen.getByRole("button", { name: "Check out" });
  fireEvent.click(button);
  assert.ok(await screen.findByText(/connection was lost/));
  const retry = screen.getByRole("button", { name: "Check out" });
  fireEvent.click(retry);
  fireEvent.click(retry);
  await waitFor(() => assert.equal(posts(calls, "/api/inventory/checkouts").length, 2));
  assert.equal((screen.getByRole("button", { name: /Recording/ }) as HTMLButtonElement).disabled, true);
  await act(async () => release());
  assert.ok(await screen.findByText("Checkout recorded."));
  const [lost, resent] = posts(calls, "/api/inventory/checkouts");
  assert.match(lost.body.idempotencyKey, UUID);
  assert.equal(resent.body.idempotencyKey, lost.body.idempotencyKey);
  assert.equal(resent.body.recipientUserId, "u-2");
});

test("D-62 + D-65: outstanding checkouts name the holder, and a double-clicked return sends one request", async () => {
  const { gate, release } = deferred();
  const checkout = { id: "c-1", inventory_item_id: "i-1", inventory_location_id: "l-1", recipient_type: "officer", recipient_user_id: "0b9f7a4e-0000-4000-8000-000000000001", recipient_unit: null, recipient_vehicle_id: null, recipient_label: "Dana Cole", quantity: 2, checked_out_at: "2026-10-22T10:00:00Z", due_at: null, outstanding_quantity: 2, overdue: false, inventory_checkout_returns: [] };
  const calls = serve(async (call) => {
    if (call.method === "POST") { await gate; return Response.json({ checkout: {} }); }
    if (call.url.startsWith("/api/inventory/checkouts")) return Response.json({ checkouts: [checkout] });
    if (call.url.startsWith("/api/inventory/items")) return Response.json({ items });
    return Response.json({ locations });
  });
  const { container } = render(<OutstandingCheckouts />);
  assert.ok(await screen.findByText(/Officer: Dana Cole/));
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-/.test(container.textContent ?? ""), false, "no identifier is shown");
  fireEvent.click(screen.getByRole("button", { name: "Return" }));
  const all = screen.getByRole("button", { name: "Return All" });
  fireEvent.click(all);
  fireEvent.click(all);
  await waitFor(() => assert.equal(posts(calls, "/returns").length, 1));
  await act(async () => release());
  assert.ok(await screen.findByText("All stock returned."));
  assert.equal(posts(calls, "/returns").length, 1);
  assert.match(posts(calls, "/returns")[0].body.idempotencyKey, UUID);
});

function servePage(onPost: (call: Call) => Promise<Response> | Response, access: { canManage: boolean; canAdjust: boolean } = { canManage: true, canAdjust: true }) {
  return serve((call) => {
    if (call.method === "POST") return onPost(call);
    if (call.url.startsWith("/api/inventory/items")) return Response.json({ items, ...access });
    if (call.url.startsWith("/api/inventory/locations")) return Response.json({ locations, canManage: access.canManage });
    if (call.url.startsWith("/api/inventory/balances")) return Response.json({ balances });
    if (call.url.startsWith("/api/inventory/checkouts")) return Response.json({ checkouts: [] });
    return Response.json(recipients);
  });
}
async function chooseLocation(label: string) {
  fireEvent.focus(screen.getByRole("combobox", { name: label }));
  fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Supply room" }));
}

test("D-65: a double-clicked Receive Stock records one receipt", async () => {
  const { gate, release } = deferred();
  const calls = servePage(async () => { await gate; return Response.json({ transaction: {} }, { status: 201 }); });
  render(<InventoryPage />);
  await screen.findAllByText("Radios");
  fireEvent.click(screen.getByRole("button", { name: "Receive Stock" }));
  const panel = screen.getByRole("heading", { name: "Receive stock" }).parentElement!;
  fireEvent.change(within(panel).getByLabelText("Item"), { target: { value: "i-1" } });
  await chooseLocation("Store at");
  fireEvent.change(within(panel).getByLabelText("Quantity received"), { target: { value: "5" } });
  const submit = within(panel).getByRole("button", { name: /Receive stock/ });
  fireEvent.click(submit);
  fireEvent.click(submit);
  await waitFor(() => assert.equal(posts(calls, "/api/inventory/transactions").length, 1));
  assert.equal((within(panel).getByRole("button", { name: /Saving/ }) as HTMLButtonElement).disabled, true);
  await act(async () => release());
  assert.ok(await screen.findByText("Saved."));
  assert.equal(posts(calls, "/api/inventory/transactions").length, 1);
  assert.match(posts(calls, "/api/inventory/transactions")[0].body.idempotencyKey, UUID);
});

test("D-70: issuing 3 consumables sends an adjust of -3 from the location, with the reason", async () => {
  const calls = servePage(() => Response.json({ transaction: {} }, { status: 201 }));
  render(<InventoryPage />);
  await screen.findAllByText("Gloves");
  fireEvent.click(screen.getByRole("button", { name: "Issue / Adjust" }));
  const panel = screen.getByRole("heading", { name: "Issue or adjust stock" }).parentElement!;
  const item = within(panel).getByLabelText("Item") as HTMLSelectElement;
  assert.deepEqual([...item.options].map((option) => option.textContent), ["Choose an inventory item", "Gloves"], "only consumables are issued");
  fireEvent.change(item, { target: { value: "i-2" } });
  await chooseLocation("From");
  fireEvent.change(within(panel).getByLabelText("Quantity to issue"), { target: { value: "3" } });
  fireEvent.click(within(panel).getByRole("button", { name: /Issue stock/ }));
  assert.ok(await screen.findByText(/A reason is required/));
  assert.equal(posts(calls, "/api/inventory/transactions").length, 0);
  fireEvent.change(within(panel).getByLabelText(/Reason/), { target: { value: "Issued to patrol" } });
  fireEvent.click(within(panel).getByRole("button", { name: /Issue stock/ }));
  await waitFor(() => assert.equal(posts(calls, "/api/inventory/transactions").length, 1));
  const body = posts(calls, "/api/inventory/transactions")[0].body;
  assert.deepEqual({ type: body.transactionType, quantity: body.quantity, source: body.sourceLocationId, destination: body.destinationLocationId, reason: body.reason }, { type: "adjust", quantity: -3, source: "l-1", destination: "", reason: "Issued to patrol" });
});

test("D-70: a count correction can add to or remove from any item, with a reason", async () => {
  const calls = servePage(() => Response.json({ transaction: {} }, { status: 201 }));
  render(<InventoryPage />);
  await screen.findAllByText("Radios");
  fireEvent.click(screen.getByRole("button", { name: "Issue / Adjust" }));
  const panel = screen.getByRole("heading", { name: "Issue or adjust stock" }).parentElement!;
  fireEvent.change(within(panel).getByLabelText(/^Purpose/), { target: { value: "remove" } });
  fireEvent.change(within(panel).getByLabelText("Item"), { target: { value: "i-1" } });
  await chooseLocation("From");
  fireEvent.change(within(panel).getByLabelText("Quantity to remove"), { target: { value: "2" } });
  fireEvent.change(within(panel).getByLabelText(/Reason/), { target: { value: "Recount: duplicate receipt" } });
  fireEvent.click(within(panel).getByRole("button", { name: /Record correction/ }));
  await waitFor(() => assert.equal(posts(calls, "/api/inventory/transactions").length, 1));
  assert.equal(posts(calls, "/api/inventory/transactions")[0].body.quantity, -2);
});

test("Owner decision: stock controls appear only for users the server lets adjust or manage", async () => {
  servePage(() => Response.json({}), { canManage: false, canAdjust: false });
  render(<InventoryPage />);
  await screen.findAllByText("Radios");
  for (const name of [/Add Item/, /Receive Stock/, /Move Stock/, /Issue \/ Adjust/]) assert.equal(screen.queryByRole("button", { name }), null, String(name));
  cleanup();
  servePage(() => Response.json({}), { canManage: false, canAdjust: true });
  render(<InventoryPage />);
  await screen.findAllByText("Radios");
  assert.equal(screen.queryByRole("button", { name: /Add Item/ }), null, "adjusting does not grant item management");
  assert.ok(screen.getByRole("button", { name: /Issue \/ Adjust/ }));
});
