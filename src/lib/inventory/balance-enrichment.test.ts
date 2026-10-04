import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { enrichInventoryBalances } from "./balance-enrichment";

const balance = {
  id: "balance-1",
  inventory_item_id: "item-1",
  inventory_location_id: "location-1",
  on_hand_quantity: "12",
  updated_at: "2026-10-04T00:00:00.000Z",
};

test("balance enrichment returns an empty response without related-table lookups", () => {
  assert.deepEqual(enrichInventoryBalances([], [], []), []);
});

test("balance enrichment attaches the separately fetched item and location summaries", () => {
  assert.deepEqual(
    enrichInventoryBalances(
      [balance],
      [
        {
          id: "item-1",
          name: "CR123 Batteries",
          category: "Batteries",
          tracking_mode: "pooled",
          unit_of_measure: "each",
          is_active: true,
        },
      ],
      [{ id: "location-1", name: "Patrol Supply Room", is_active: true }],
    ),
    [
      {
        ...balance,
        inventory_items: {
          id: "item-1",
          name: "CR123 Batteries",
          category: "Batteries",
          tracking_mode: "pooled",
          unit_of_measure: "each",
          is_active: true,
        },
        inventory_locations: {
          id: "location-1",
          name: "Patrol Supply Room",
          is_active: true,
        },
      },
    ],
  );
});

test("balances route applies the location filter and scopes every inventory query to the department", async () => {
  const route = await readFile(
    "src/app/api/inventory/balances/route.ts",
    "utf8",
  );

  assert.match(route, /\.eq\("inventory_location_id",\s*locationId\)/);
  assert.equal(
    (route.match(/\.eq\("department_id",\s*c\.departmentId\)/g) ?? []).length,
    3,
  );
  assert.match(route, /\.in\("id",\s*itemIds\)/);
  assert.match(route, /\.in\("id",\s*locationIds\)/);
  assert.doesNotMatch(route, /inventory_items\(/);
  assert.doesNotMatch(route, /inventory_locations\(/);
});
