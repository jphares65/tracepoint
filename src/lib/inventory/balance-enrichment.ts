export type InventoryBalanceRow = {
  id: string;
  inventory_item_id: string;
  inventory_location_id: string;
  on_hand_quantity: number | string;
  updated_at: string;
};

export type InventoryItemSummary = {
  id: string;
  name: string;
  category: string;
  tracking_mode: "pooled" | "consumable";
  unit_of_measure: string;
  is_active: boolean;
};

export type InventoryLocationSummary = {
  id: string;
  name: string;
  is_active: boolean;
};

export function enrichInventoryBalances(
  balances: InventoryBalanceRow[],
  items: InventoryItemSummary[],
  locations: InventoryLocationSummary[],
) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const locationsById = new Map(
    locations.map((location) => [location.id, location]),
  );

  return balances.map((balance) => ({
    ...balance,
    inventory_items: itemsById.get(balance.inventory_item_id) ?? null,
    inventory_locations:
      locationsById.get(balance.inventory_location_id) ?? null,
  }));
}
