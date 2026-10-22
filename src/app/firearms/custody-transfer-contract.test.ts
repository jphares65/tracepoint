import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("UX-RB-4: the firearm record page sends the restricted custody contract and gates on server operations", async () => {
  const page = await readFile(new URL("./[firearmId]/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /toHolderType:/);
  assert.doesNotMatch(page, /administrativeCorrection/);
  assert.match(page, /const body = restrictedCustodyRequest\(\{/);
  assert.match(page, /action: transferDestination === "SECURE_STORAGE" \? "CHECK_IN" : "CHECK_OUT"/);
  assert.match(page, /custody\?\.operations\?\.canCheckIn && <button/);
  assert.match(page, /custody\?\.operations\?\.canCheckOut && firearm\.active_assignment && <button/);
  assert.match(page, /\{custodyEventSummary\(event\)\}/);
});

test("UX-RB-4 / C-64: the Restricted tab sends the notes the officer typed", async () => {
  const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  assert.match(page, /\{ action: "CHECK_OUT", notes: restrictedUseReason\.trim\(\) \|\| null,/);
  assert.match(page, /action: "CHECK_IN", storageLocationId: [^}]*notes: restrictedUseReason\.trim\(\) \|\| null,/);
});
