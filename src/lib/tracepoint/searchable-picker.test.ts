import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  filterSearchablePickerOptions,
  nextSearchablePickerIndex,
} from "./searchable-picker";

const locations = [
  { id: "room", label: "Patrol Supply Room" },
  { id: "car", label: "Car 12", detail: "Vehicle storage" },
];

test("searchable picker filters location names and exposes an empty state", () => {
  assert.deepEqual(filterSearchablePickerOptions(locations, "supply"), [
    locations[0],
  ]);
  assert.deepEqual(filterSearchablePickerOptions(locations, "missing"), []);
});

test("searchable picker keyboard navigation remains within available options", () => {
  assert.equal(nextSearchablePickerIndex(0, 2, 1), 1);
  assert.equal(nextSearchablePickerIndex(1, 2, 1), 1);
  assert.equal(nextSearchablePickerIndex(0, 2, -1), 0);
  assert.equal(nextSearchablePickerIndex(0, 0, 1), 0);
});

test("shared picker supports selection, keyboard controls, and optional create action", async () => {
  const component = await readFile(
    "src/app/components/SearchablePicker.tsx",
    "utf8",
  );
  assert.match(component, /role="combobox"/);
  assert.match(component, /ArrowDown/);
  assert.match(component, /Enter/);
  assert.match(component, /Escape/);
  assert.match(component, /No matches found/);
  assert.match(component, /Loading options/);
  assert.match(component, /createAction\.onSelect\(\)/);
});

test("inventory location creation refreshes options and selects the new location", async () => {
  const page = await readFile("src/app/inventory/page.tsx", "utf8");
  assert.match(page, /label: "Create new location"/);
  assert.match(
    page,
    /setLocations\(\(current\) =>\s*\[\.\.\.current, created\]/,
  );
  assert.match(page, /destinationLocationId: created\.id/);
  assert.match(page, /sourceLocationId: created\.id/);
  assert.match(page, /await load\(\)/);
});
