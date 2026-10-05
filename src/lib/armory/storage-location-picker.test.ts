import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const pagePath = "src/app/firearms/page.tsx";

test("duty-only check-in uses a searchable secure-storage combobox", async () => {
  const page = await readFile(pagePath, "utf8");

  assert.doesNotMatch(page, /Secure storage<select/);
  assert.match(page, /role="combobox"/);
  assert.match(page, /placeholder="Search secure storage"/);
  assert.match(page, /const filteredStorageLocations = useMemo/);
  assert.match(page, /location\.name\.toLocaleLowerCase\(\)\.includes\(normalizedStorageLocationQuery\)/);
  assert.match(page, /className="w-full min-w-0 rounded-xl/);
  assert.match(page, /No active secure-storage locations configured\./);
});

test("only storage-location managers can create a typed secure-storage value", async () => {
  const page = await readFile(pagePath, "utf8");

  assert.match(page, /hasPermission\("firearm_custody\.manage_storage_locations"\)/);
  assert.match(page, /hasPermission\("manage_firearms"\)/);
  assert.match(page, /if \(!name \|\| hasStorageLocationMatch \|\| !canManageStorageLocations\) return;/);
  assert.match(page, /canManageStorageLocations && normalizedStorageLocationQuery && !hasStorageLocationMatch/);
  assert.match(page, /Create "\$\{storageLocationQuery\.trim\(\)\}"/);
});

test("created secure storage is selected and check-in preserves its existing payload", async () => {
  const page = await readFile(pagePath, "utf8");

  assert.match(page, /fetch\("\/api\/armory\/storage-locations", \{\s*method: "POST"/);
  assert.match(page, /if \(!response\.ok\) throw new Error\(await readError\(response\)\);/);
  assert.match(page, /setRestrictedStorageLocationId\(location\.id\)/);
  assert.match(page, /const createdLocationId = payload\.storageLocationId;/);
  assert.match(page, /selectStorageLocation\(createdLocation\);/);
  assert.match(page, /storageLocationId: restrictedStorageLocationId \|\| storageLocations\[0\]\?\.id/);
  assert.match(page, /storageLocationError && <p role="alert"/);
});
