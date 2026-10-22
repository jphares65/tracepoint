/* eslint-disable @typescript-eslint/no-explicit-any -- module-cache stubs */
import "@/lib/testing/dom";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, test } from "node:test";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// C-R1: a submitted reconciliation is not pulled back to Draft by Save Draft.
const require = createRequire(import.meta.url);
const passthrough = { __esModule: true, default: ({ children }: { children?: ReactNode }) => <>{children}</> };
for (const path of ["../../../components/TracePointShell.tsx", "../../../components/ArmorySectionShell.tsx"])
  require.cache[require.resolve(path)] = { id: path, filename: path, loaded: true, exports: passthrough } as any;
const ReconciliationPage = require("./page.tsx").default as () => ReactNode;

afterEach(cleanup);

const item = { lotId: "lot-1", category: "Duty", caliber: "9mm", manufacturer: "X", lotNumber: "L1", expectedQuantity: 500, physicalQuantity: 480, variance: -20, explanation: "Range issue" };
const active = (status: string) => ({ id: "rec-1", cycleName: "Spring", cycleYear: 2026, cycleStart: "2026-03-01", cycleEnd: "2026-05-31", status, notes: null, createdAt: "2026-03-02T00:00:00Z", submittedAt: status === "Draft" ? null : "2026-03-03T00:00:00Z", certifiedAt: null, createdByName: "A", submittedByName: "A", certifiedByName: null, items: [item] });
function serve(status: string, canCertify = false, canWithdraw = true) {
  const posts: any[] = [];
  let current = status;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      if (body.action === "withdraw") current = "Draft";
      return Response.json({ ok: true });
    }
    return Response.json({ access: { canManage: true, canCertify, canWithdraw }, currentCycle: { name: "Spring", year: 2026, start: "2026-03-01", end: "2026-05-31", isOpen: true }, active: active(current), history: [] });
  }) as typeof fetch;
  return posts;
}

test("C-R1: a submitted count offers no Save Draft and its counts cannot be edited", async () => {
  serve("Submitted");
  render(<ReconciliationPage />);
  assert.ok(await screen.findByText("Submitted for command certification."));
  assert.equal(screen.queryByRole("button", { name: /Save Draft/ }) === null, true, "no Save Draft once submitted");
  assert.equal((screen.getByLabelText("Physical count for lot L1") as HTMLInputElement).disabled, true);
});

test("C-R1: withdrawing to draft is a confirmed, separate action", async () => {
  const posts = serve("Submitted");
  render(<ReconciliationPage />);
  fireEvent.click(await screen.findByRole("button", { name: /Withdraw to draft/ }));
  assert.equal(posts.length, 0, "the first click only asks for confirmation");
  fireEvent.click(screen.getByRole("button", { name: "Keep submitted" }));
  assert.equal(posts.length, 0);
  fireEvent.click(screen.getByRole("button", { name: /Withdraw to draft/ }));
  const confirm = screen.getByRole("button", { name: "Withdraw to draft" });
  assert.equal((confirm as HTMLButtonElement).disabled, true, "a reason is required");
  fireEvent.change(screen.getByLabelText("Reason for withdrawal"), { target: { value: "Recount of lot L1 requested" } });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0].action, "withdraw");
  assert.equal(posts[0].reason, "Recount of lot L1 requested");
  assert.ok(await screen.findByText(/withdrawn to draft/));
  assert.ok(await screen.findByRole("button", { name: /Save Draft/ }));
  assert.equal((screen.getByLabelText("Physical count for lot L1") as HTMLInputElement).disabled, false);
});

test("Owner decision: without the management permission there is no withdraw control", async () => {
  serve("Submitted", false, false);
  render(<ReconciliationPage />);
  assert.ok(await screen.findByText("Submitted for command certification."));
  assert.equal(screen.queryByRole("button", { name: /Withdraw to draft/ }), null);
});
