import assert from "node:assert/strict";
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
    new Set(),
    true,
  );

  assert.deepEqual(
    visible.map((item) => item.label),
    ["Settings", "Import / Export", "Agency Documents"],
  );
});
