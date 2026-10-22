/* eslint-disable @typescript-eslint/no-explicit-any -- module-cache stubs */
import "@/lib/testing/dom";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, test } from "node:test";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// C-32: the ammunition page saves against the revision it loaded, and a
// refused (stale) save reloads the ledger instead of overwriting it.
const require = createRequire(import.meta.url);
const passthrough = { __esModule: true, default: ({ children }: { children?: ReactNode }) => <>{children}</> };
for (const path of ["../../components/TracePointShell.tsx", "../../components/ArmorySectionShell.tsx"])
  require.cache[require.resolve(path)] = { id: path, filename: path, loaded: true, exports: passthrough } as any;
const AmmunitionPage = require("./page.tsx").default as () => ReactNode;

afterEach(cleanup);

test("C-32: each save sends the revision it is based on; a stale save is not kept and the ledger reloads", async () => {
  const puts: any[] = [];
  let gets = 0;
  const replies = [
    () => Response.json({ message: "saved", updatedAt: "2026-10-20T11:00:00.000Z" }),
    () => Response.json({ error: "The ammunition ledger changed since you loaded it, so this change was not saved. Reload the ledger and make the change again.", code: "stale_workspace" }, { status: 409 }),
  ];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") { puts.push(JSON.parse(String(init.body))); return replies[puts.length - 1](); }
    gets += 1;
    return Response.json({ workspace: null, updatedAt: gets === 1 ? "2026-10-20T10:00:00.000Z" : "2026-10-20T12:00:00.000Z" });
  }) as typeof fetch;
  render(<AmmunitionPage />);
  fireEvent.click(await screen.findByRole("button", { name: /Types & Rules/ }));
  const save = await screen.findByRole("button", { name: /Save Agency Defaults/ });
  fireEvent.click(save);
  await waitFor(() => assert.equal(puts.length, 1));
  assert.equal(puts[0].baseUpdatedAt, "2026-10-20T10:00:00.000Z");
  assert.ok(await screen.findByText("Agency ammunition defaults saved."));
  fireEvent.click(screen.getByRole("button", { name: /Save Agency Defaults/ }));
  await waitFor(() => assert.equal(puts.length, 2));
  assert.equal(puts[1].baseUpdatedAt, "2026-10-20T11:00:00.000Z", "the next save is based on the revision just written");
  assert.ok(await screen.findByText(/changed since you loaded it.*The latest ledger is now shown\./));
  assert.equal(gets, 2, "the stale save reloads the ledger");
  assert.equal(screen.queryByText("Agency ammunition defaults saved.") === null, true);
});
