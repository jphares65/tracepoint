import "@/lib/testing/dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";

import OffDutyRulesPanel from "./OffDutyRulesPanel.tsx";

// Allow time when the test runner is busy with other files.
configure({ asyncUtilTimeout: 5000 });
afterEach(cleanup);

type Call = { method: string; body: Record<string, unknown> | null };
const STORED = { requireInspection: true, requireQualification: true, renewalDays: 365, inspectionIntervalDays: 180, inspectionDueSoonDays: 30 };
function serve(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const call = { method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

test("SV-29: a save is confirmed beside its button and the form shows what the server stored", async () => {
  // The server normalises the renewal to 730 days; the form must show that, not the typed value.
  const calls = serve((call) => Response.json({ rules: call.method === "PATCH" ? { ...call.body, renewalDays: 730 } : STORED }));
  const saved: unknown[] = [];
  const dirty: boolean[] = [];
  render(<OffDutyRulesPanel onSaved={(rules) => saved.push(rules)} onDirtyChange={(value) => dirty.push(value)} />);
  const renewal = await screen.findByRole("spinbutton", { name: /Authorization renewal/ });
  fireEvent.change(renewal, { target: { value: "700" } });
  assert.ok(screen.getByText("Unsaved changes"));
  assert.equal(dirty.at(-1), true);

  fireEvent.click(screen.getByRole("button", { name: "Save Off-Duty Rules" }));
  const status = await screen.findByRole("status", { name: "Off-Duty Rules save status" });
  assert.match(status.textContent ?? "", /Off-duty firearm rules saved\./);
  assert.equal((screen.getByRole("spinbutton", { name: /Authorization renewal/ }) as HTMLInputElement).value, "730");
  assert.equal(calls.filter((call) => call.method === "PATCH")[0].body!.renewalDays, 700);
  assert.deepEqual(saved, [{ ...STORED, renewalDays: 730 }]);
  assert.equal(dirty.at(-1), false);
  assert.equal(screen.queryByText("Unsaved changes") === null, true);
});

test("SV-29: a refused save is reported beside the button and keeps the edit", async () => {
  serve((call) => call.method === "PATCH"
    ? Response.json({ error: "Department administration permission is required to modify off-duty firearm policy." }, { status: 403 })
    : Response.json({ rules: STORED }));
  render(<OffDutyRulesPanel />);
  fireEvent.click(await screen.findByRole("checkbox", { name: /Require Independent Qualification/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save Off-Duty Rules" }));
  const alert = await screen.findByRole("alert", { name: "Off-Duty Rules save status" });
  assert.match(alert.textContent ?? "", /Department administration permission is required.*Your changes are still on this form\./);
  assert.equal((screen.getByRole("checkbox", { name: /Require Independent Qualification/ }) as HTMLInputElement).checked, false);
  assert.ok(screen.getByText("Unsaved changes"));
});

test("SV-29: when the rules cannot be loaded, defaults are never shown or saved", async () => {
  const calls = serve(() => Response.json({ error: "Off-duty rules are unavailable." }, { status: 500 }));
  render(<OffDutyRulesPanel />);
  assert.ok(await screen.findByText(/Off-duty rules are unavailable\. The current off-duty rules are unchanged; nothing can be saved until they load\./));
  assert.equal(screen.queryByRole("button", { name: "Save Off-Duty Rules" }) === null, true);
  serve(() => Response.json({ rules: { ...STORED, renewalDays: 400 } }));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => assert.equal((screen.getByRole("spinbutton", { name: /Authorization renewal/ }) as HTMLInputElement).value, "400"));
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 0);
});
