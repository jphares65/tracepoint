import "@/lib/testing/dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import FleetRulesPanel from "./FleetRulesPanel.tsx";

afterEach(cleanup);

type Call = { method: string; body: Record<string, unknown> | null };
function serve(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const call = { method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

test("UX-RB2-2 (D-27): a second inspector role code can be typed and is saved", async () => {
  const calls = serve((call) => Response.json({ rules: call.body ?? { inspection_role_codes: ["patrol"] } }));
  render(<FleetRulesPanel />);
  const field = await screen.findByLabelText("Permitted inspector role codes");
  assert.equal((field as HTMLInputElement).value, "patrol");
  fireEvent.change(field, { target: { value: "patrol," } });
  assert.equal((field as HTMLInputElement).value, "patrol,", "the trailing comma stays while typing");
  fireEvent.change(field, { target: { value: "patrol, sergeant" } });
  fireEvent.click(screen.getByRole("button", { name: /Save Fleet Rules/ }));
  await waitFor(() => assert.equal(calls.filter((call) => call.method === "PUT").length, 1));
  assert.deepEqual(calls.find((call) => call.method === "PUT")!.body!.inspection_role_codes, ["patrol", "sergeant"]);
});

test("UX-RB2-2 (D-28): when the rules cannot be loaded, the defaults are never shown or saved", async () => {
  const calls = serve(() => Response.json({ error: "Fleet rules are unavailable." }, { status: 500 }));
  render(<FleetRulesPanel />);
  assert.ok(await screen.findByText(/Fleet rules are unavailable\. The current rules are unchanged; nothing can be saved until they load\./));
  assert.equal(screen.queryByRole("button", { name: /Save Fleet Rules/ }), null);
  assert.equal(screen.queryByLabelText("Permitted inspector role codes"), null);
  serve(() => Response.json({ rules: { inspection_role_codes: ["patrol"] } }));
  fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
  assert.equal(((await screen.findByLabelText("Permitted inspector role codes")) as HTMLInputElement).value, "patrol");
  assert.equal(calls.filter((call) => call.method === "PUT").length, 0);
});
