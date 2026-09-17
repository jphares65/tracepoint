import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FOCUS_INVENTORY_PREFERENCES,
  FOCUS_INVENTORY_COLUMNS,
  getStandardDefaultHiddenColumns,
  getFocusInventoryPreferenceKey,
  getStoredFocusInventoryPreferences,
  moveFocusInventoryColumn,
  normalizeFocusInventoryPreferences,
  saveFocusInventoryPreferences,
  shouldSortFocusColumnHeader,
  type FocusInventoryPreferences,
} from "./inventory-focus-preferences.ts";

test("normalizes saved inventory columns while retaining newly available columns", () => {
  assert.deepEqual(
    normalizeFocusInventoryPreferences({
      columnOrder: ["status", "serial", "invalid"] as never[],
      hiddenColumns: ["asset", "invalid"] as never[],
    }),
    {
      columnOrder: ["status", "serial", "firearm", "asset", "type", "custody"],
      hiddenColumns: ["asset"],
      groupBy: "none",
      collapsedGroupKeys: [],
    },
  );
  assert.deepEqual(
    normalizeFocusInventoryPreferences(undefined),
    DEFAULT_FOCUS_INVENTORY_PREFERENCES,
  );
});

test("moves a shared inventory column without changing the remaining sequence", () => {
  assert.deepEqual(
    moveFocusInventoryColumn(
      ["firearm", "serial", "asset", "type", "status", "custody"],
      "custody",
      "serial",
    ),
    ["firearm", "custody", "serial", "asset", "type", "status"],
  );
});

test("keeps Type / Caliber available while hiding it for a new Standard layout only", () => {
  assert.equal(FOCUS_INVENTORY_COLUMNS.includes("type"), true);
  assert.deepEqual(getStandardDefaultHiddenColumns([], false), ["type"]);
  assert.deepEqual(getStandardDefaultHiddenColumns([], true), []);
  assert.deepEqual(
    getStandardDefaultHiddenColumns(["asset"], false),
    ["asset", "type"],
  );
});

test("only reorders on drop and suppresses the follow-up sort click from a drag", () => {
  const columns = ["firearm", "serial", "asset", "type", "status", "custody"] as const;
  assert.deepEqual(moveFocusInventoryColumn([...columns], "serial", "serial"), columns);
  assert.deepEqual(
    moveFocusInventoryColumn([...columns], "serial", "status"),
    ["firearm", "asset", "type", "serial", "status", "custody"],
  );
  assert.equal(shouldSortFocusColumnHeader(true), false);
  assert.equal(shouldSortFocusColumnHeader(false), true);
});

test("persists one column layout that both inventory views can reuse", () => {
  const values = new Map<string, string>();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  });

  try {
    const preferences: FocusInventoryPreferences = {
      columnOrder: ["custody", "serial", "firearm", "asset", "type", "status"],
      hiddenColumns: ["asset"],
      groupBy: "status",
      collapsedGroupKeys: ["status:Maintenance"],
    };

    saveFocusInventoryPreferences("demo-agency", preferences);

    assert.equal(
      values.has(getFocusInventoryPreferenceKey("demo-agency")),
      true,
    );
    assert.deepEqual(
      getStoredFocusInventoryPreferences("demo-agency"),
      preferences,
    );
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});
