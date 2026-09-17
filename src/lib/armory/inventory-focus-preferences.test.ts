import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FOCUS_INVENTORY_PREFERENCES,
  moveFocusInventoryColumn,
  normalizeFocusInventoryPreferences,
} from "./inventory-focus-preferences.ts";

test("normalizes saved Focus columns while retaining newly available columns", () => {
  assert.deepEqual(
    normalizeFocusInventoryPreferences({
      columnOrder: ["status", "serial", "invalid"] as never[],
      hiddenColumns: ["asset", "invalid"] as never[],
    }),
    {
      columnOrder: ["status", "serial", "firearm", "asset", "type", "custody"],
      hiddenColumns: ["asset"],
    },
  );
  assert.deepEqual(
    normalizeFocusInventoryPreferences(undefined),
    DEFAULT_FOCUS_INVENTORY_PREFERENCES,
  );
});

test("moves a Focus column without changing the remaining sequence", () => {
  assert.deepEqual(
    moveFocusInventoryColumn(
      ["firearm", "serial", "asset", "type", "status", "custody"],
      "custody",
      "serial",
    ),
    ["firearm", "custody", "serial", "asset", "type", "status"],
  );
});
