import assert from "node:assert/strict";
import test from "node:test";

import {
  getStoredTableGroupingPreferences,
  groupTableRows,
  saveTableGroupingPreferences,
  toggleCollapsedTableGroup,
} from "./grouping.ts";

type Firearm = { id: string; type: string; serial: string };
const GROUP_BY = ["none", "type"] as const;

function groupedFirearms(rows: Firearm[], groupBy: (typeof GROUP_BY)[number]) {
  return groupTableRows(rows, groupBy, (firearm) => ({
    key: firearm.type,
    label: firearm.type,
  }));
}

test("groups filtered Firearms by type while preserving their sorted order", () => {
  const filteredAndSorted = [
    { id: "2", type: "Handgun", serial: "A-2" },
    { id: "1", type: "Handgun", serial: "A-10" },
    { id: "3", type: "Rifle", serial: "B-1" },
  ];
  const groups = groupedFirearms(filteredAndSorted, "type");

  assert.deepEqual(groups.map((group) => [group.label, group.items.map((item) => item.serial)]), [
    ["Handgun", ["A-2", "A-10"]],
    ["Rifle", ["B-1"]],
  ]);
});

test("supports collapse state and restores a flat view for None", () => {
  assert.deepEqual(toggleCollapsedTableGroup([], "type:Handgun"), ["type:Handgun"]);
  assert.deepEqual(toggleCollapsedTableGroup(["type:Handgun"], "type:Handgun"), []);
  assert.deepEqual(groupedFirearms([{ id: "1", type: "Handgun", serial: "A-1" }], "none"), []);
});

test("persists a module-specific grouping selection", () => {
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
    saveTableGroupingPreferences(
      "tracepoint:test:groups",
      { groupBy: "type", collapsedGroupKeys: ["type:Handgun"] },
      GROUP_BY,
      "none",
    );
    assert.deepEqual(
      getStoredTableGroupingPreferences("tracepoint:test:groups", GROUP_BY, "none"),
      { groupBy: "type", collapsedGroupKeys: ["type:Handgun"] },
    );
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
