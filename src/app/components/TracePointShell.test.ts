import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getVisibleChildren,
  NAV_ITEMS,
} from "./TracePointShell.tsx";

test("support-mode department administrators retain Agency Documents in Administration navigation", () => {
  const administration = NAV_ITEMS.find(
    (item) => "children" in item && item.label === "Administration",
  );

  assert.ok(administration && "children" in administration);

  const visible = getVisibleChildren(
    administration,
    ["administer_department"],
    new Set(["agency_documents"]),
  );

  assert.deepEqual(
    visible.map((item) => item.label),
    ["Settings", "Import / Export", "Agency Documents"],
  );
});

test("Agency Documents leaves the navigation when the platform administrator has not enabled it", () => {
  const administration = NAV_ITEMS.find(
    (item) => "children" in item && item.label === "Administration",
  );

  assert.ok(administration && "children" in administration);

  const visible = getVisibleChildren(
    administration,
    ["administer_department"],
    new Set(),
  );

  assert.deepEqual(
    visible.map((item) => item.label),
    ["Settings", "Import / Export"],
  );
});

test("sidebar groups start collapsed and route changes do not override user state", async () => {
  const source = await readFile("src/app/components/TracePointShell.tsx", "utf8");

  assert.match(source, /const \[openGroups, setOpenGroups\] = useState<Set<string>>\(\s*\(\) => new Set\(\),\s*\);/);
  assert.doesNotMatch(source, /activeGroupLabel/);
  assert.match(source, /function toggleGroup\(label: string\) \{\s*setOpenGroups\(\(current\) => toggleExpandedGroup\(current, label\)\);\s*\}/);
  assert.match(source, /onClick=\{\(\) => toggleGroup\(item\.label\)\}/);
});
