/* eslint-disable @typescript-eslint/no-explicit-any -- module-cache stub */
import "@/lib/testing/dom";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, test } from "node:test";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// C-48: one tap is one request or decision, results are shown where the user
// acted (never window.alert), and a reviewer is not offered decisions on
// their own request (ARM-26).
const require = createRequire(import.meta.url);
require.cache[require.resolve("../components/TracePointShell.tsx")] = {
  id: "shell", filename: "shell", loaded: true,
  exports: { __esModule: true, default: ({ children }: { children: ReactNode }) => <>{children}</> },
} as any;
const OffDutyFirearmsPage = require("./page.tsx").default as () => ReactNode;

afterEach(cleanup);
let alerts: string[] = [];
window.alert = (message?: unknown) => { alerts.push(String(message)); };

const record = (id: string, officerId: string, officer: string) => ({
  id, officerId, officer, badge: "1", unit: "Patrol", make: "Glock", model: "43", firearmType: "Semi-Automatic Pistol", serial: `SN-${id}`, caliber: "9mm",
  capacity: "", optic: "", weaponLight: "", holster: "", proofOwnership: true, qualificationReviewed: true, inspectionReviewed: true, policyAcknowledged: true,
  officerNotes: "", requestStatus: "Pending Command Review", authorizationStatus: "Not Authorized", submittedAt: "2026-10-20T10:00:00Z",
  lastQual: "", qualificationStatus: "Current", qualificationReason: "", inspectionStatus: "Not Inspected", compliance: "Pending", auditTrail: [],
});
type Call = { method: string; url: string; body: any };
function serve(write: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const call = { method: init?.method ?? "GET", url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    if (call.method !== "GET") return write(call);
    if (call.url.includes("/inspections")) return Response.json({ inspections: [] });
    return Response.json({ records: [record("od-own", "me", "Chief Me"), record("od-other", "officer-2", "Officer Two")], currentUser: { id: "me" }, canReview: true, canSubmit: true, canManageInspections: false });
  }) as typeof fetch;
  return calls;
}
function deferred() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release };
}
const writes = (calls: Call[]) => calls.filter((call) => call.method !== "GET");

async function openRequestDrawer() {
  fireEvent.click(await screen.findByRole("button", { name: /Submit New Request/ }));
  const drawer = screen.getByRole("dialog", { name: /Submit Off-Duty Firearm Request/ });
  for (const [placeholder, value] of [["Make *", "Sig"], ["Model *", "P365"], ["Serial Number *", "abc1"], ["Caliber *", "9mm"]])
    fireEvent.change(within(drawer).getByPlaceholderText(placeholder), { target: { value } });
  fireEvent.click(within(drawer).getByLabelText(/proof of ownership is available/));
  fireEvent.click(within(drawer).getByLabelText(/acknowledge the off-duty firearm policy/));
  return drawer;
}

test("C-48: a refused submission is shown inside the drawer, never in window.alert", async () => {
  alerts = [];
  serve(() => Response.json({ error: "An off-duty firearm request with this serial number already exists for the department." }, { status: 409 }));
  render(<OffDutyFirearmsPage />);
  const drawer = await openRequestDrawer();
  fireEvent.click(within(drawer).getByRole("button", { name: /Submit to Chief/ }));
  assert.ok(await within(drawer).findByText(/serial number already exists/));
  assert.deepEqual(alerts, []);
  assert.equal(screen.queryByRole("dialog", { name: /Submit Off-Duty Firearm Request/ }) !== null, true, "the drawer stays open with the typed request");
});

test("C-48: a double-clicked Submit sends one request, then the drawer closes with a confirmation", async () => {
  alerts = [];
  const { gate, release } = deferred();
  const calls = serve(async () => { await gate; return Response.json({ ok: true, requestId: "od-new", records: [] }, { status: 201 }); });
  render(<OffDutyFirearmsPage />);
  const drawer = await openRequestDrawer();
  const submit = within(drawer).getByRole("button", { name: /Submit to Chief/ });
  fireEvent.click(submit);
  fireEvent.click(submit);
  await waitFor(() => assert.equal(writes(calls).length, 1));
  assert.equal((within(drawer).getByRole("button", { name: /Submitting/ }) as HTMLButtonElement).disabled, true);
  await act(async () => release());
  assert.ok(await screen.findByText(/Request submitted for command review/));
  assert.equal(screen.queryByRole("dialog", { name: /Submit Off-Duty Firearm Request/ }) === null, true);
  assert.equal(writes(calls).length, 1);
});

async function openReview(officer: string) {
  fireEvent.click(await screen.findByRole("button", { name: /Department Review/ }));
  const card = (await screen.findByText(officer)).closest("article") as HTMLElement;
  fireEvent.click(within(card).getByRole("button", { name: /Review Request/ }));
  return screen.getByRole("dialog", { name: /review/i });
}

test("C-48: a double-clicked decision sends one request and its refusal appears in the drawer", async () => {
  alerts = [];
  const { gate, release } = deferred();
  const calls = serve(async () => { await gate; return Response.json({ error: "You cannot decide this request." }, { status: 403 }); });
  render(<OffDutyFirearmsPage />);
  const drawer = await openReview("Officer Two");
  const approve = within(drawer).getByRole("button", { name: /Approve/ });
  fireEvent.click(approve);
  fireEvent.click(approve);
  await waitFor(() => assert.equal(writes(calls).length, 1));
  await act(async () => release());
  assert.ok(await within(drawer).findByText("You cannot decide this request."));
  assert.deepEqual(alerts, []);
  assert.equal(writes(calls).length, 1);
});

test("ARM-26 / C-48: a reviewer is not offered decisions on their own request", async () => {
  serve(() => Response.json({}));
  render(<OffDutyFirearmsPage />);
  const drawer = await openReview("Chief Me");
  assert.equal(within(drawer).queryByRole("button", { name: /Approve/ }) === null, true);
  assert.ok(within(drawer).getByText(/another reviewer must decide it/));
});
