import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const recordPage = () => readFile(new URL("./[firearmId]/page.tsx", import.meta.url), "utf8");
const firearmsPage = () => readFile(new URL("./page.tsx", import.meta.url), "utf8");

test("UX-RB-4 / SV-28: the record page sends the restricted contract or the ordinary transfer, chosen from server operations", async () => {
  const page = await recordPage();
  // Bodies come from the shared builders only; corrections are never sent.
  assert.doesNotMatch(page, /toHolderType:/);
  assert.doesNotMatch(page, /administrativeCorrection/);
  assert.doesNotMatch(page, /canCorrectCustody/);
  assert.match(page, /const custodyActions = custodyPageActions\(custody\?\.operations\);/);
  assert.match(page, /operation === "restricted"\s*\n\s*\/\/[^\n]*\n\s*\? restrictedCustodyRequest\(\{ action: direction,/);
  assert.match(page, /: custodyTransferRequest\(\{ direction, toHolderUserId: transferDestination === "TEMPORARY" \? temporaryRecipientId : checkOutToUserId,/);
  assert.match(page, /custodyActions\.checkIn && <button/);
  assert.match(page, /custodyActions\.checkOut && firearm\.active_assignment && <button/);
  assert.match(page, /\{custodyEventSummary\(event\)\}/);
});

test("SV-28: the record page prevents double submit and shows server errors inline", async () => {
  const page = await recordPage();
  assert.match(page, /if \(transferSubmitting\.current\) return;/);
  assert.match(page, /transferSubmitting\.current = true;/);
  assert.match(page, /finally \{\s*transferSubmitting\.current = false;/);
  // One idempotency key per opened form, reused on retry.
  assert.match(page, /setTransferKey\(crypto\.randomUUID\(\)\)/);
  assert.match(page, /const idempotencyKey = transferKey \|\| crypto\.randomUUID\(\);/);
  assert.match(page, /if \(!response\.ok\) throw new Error\(payload\.error \?\?/);
  assert.match(page, /\{transferError && <p role="alert"/);
  assert.match(page, /disabled=\{transferBusy \|\| \(transferDestination === "SECURE_STORAGE" && storageLocations\.length === 0\)\}/);
  // History is reloaded after a transfer.
  assert.match(page, /await refreshCustody\(\);\s*\n\s*setTransferDestination\(null\);/);
});

test("SV-31: the record page links to storage-location management next to the picker, only for permitted users", async () => {
  const page = await recordPage();
  assert.match(page, /transferDestination === "SECURE_STORAGE" && custody\?\.operations\?\.canManageStorageLocations && <Link href=\{STORAGE_LOCATIONS_HREF\}/);
});

test("UX-RB-4 / C-64: the Restricted tab sends the notes the officer typed", async () => {
  const page = await firearmsPage();
  assert.match(page, /\{ action: "CHECK_OUT", notes: restrictedUseReason\.trim\(\) \|\| null,/);
  assert.match(page, /action: "CHECK_IN", storageLocationId: [^}]*notes: restrictedUseReason\.trim\(\) \|\| null,/);
});

test("SV-31: the Restricted tab links to storage-location management next to the picker, only for permitted users", async () => {
  const page = await firearmsPage();
  assert.match(page, /const canOpenStorageLocationManagement = canLinkToStorageLocationManagement\(hasPermission\);/);
  assert.match(page, /\{canOpenStorageLocationManagement && \(\s*<Link href=\{STORAGE_LOCATIONS_HREF\}/);
  const picker = page.indexOf('htmlFor="restricted-storage-location"');
  const link = page.indexOf("<Link href={STORAGE_LOCATIONS_HREF}");
  assert.ok(picker > 0 && link > picker && link - picker < 600, "the link sits beside the storage-location picker label");
});

test("SV-31: the storage-location screen reuses the management panel and is gated by the permission the database checks", async () => {
  const [screen, link, permissions] = await Promise.all([
    readFile(new URL("./storage-locations/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../lib/armory/storage-location-link.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/tracepoint/permissions.ts", import.meta.url), "utf8"),
  ]);
  assert.match(screen, /<SecureStorageLocationsPanel \/>/);
  assert.match(link, /STORAGE_LOCATIONS_HREF = "\/firearms\/storage-locations"/);
  assert.match(link, /"firearm_custody\.manage_storage_locations"/);
  assert.match(permissions, /\{ prefix: "\/firearms\/storage-locations", requirement: \{ anyOf: \["firearm_custody\.manage_storage_locations"\] \} \}/);
});
