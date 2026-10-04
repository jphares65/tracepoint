import { NextRequest, NextResponse } from "next/server";
import {
  getInventoryServerContext,
  inventoryDenied,
  text,
} from "@/lib/tracepoint/inventory-server";
import {
  enrichInventoryBalances,
  type InventoryBalanceRow,
} from "@/lib/inventory/balance-enrichment";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const c = await getInventoryServerContext();
  if ("error" in c) return c.error;
  if (!c.canView) return inventoryDenied("view");
  const locationId = text(request.nextUrl.searchParams.get("locationId"), 100);
  let query = c.db
    .from("inventory_balances")
    .select(
      "id,inventory_item_id,inventory_location_id,on_hand_quantity,updated_at",
    )
    .eq("department_id", c.departmentId)
    .order("updated_at", { ascending: false });
  if (locationId) query = query.eq("inventory_location_id", locationId);
  const { data: balances, error: balancesError } = await query;
  if (balancesError)
    return NextResponse.json({ error: balancesError.message }, { status: 500 });
  const balanceRows = (balances ?? []) as InventoryBalanceRow[];
  if (!balanceRows.length) return NextResponse.json({ balances: [] });
  const itemIds = [
    ...new Set(balanceRows.map((balance) => balance.inventory_item_id)),
  ];
  const locationIds = [
    ...new Set(balanceRows.map((balance) => balance.inventory_location_id)),
  ];
  const [
    { data: items, error: itemsError },
    { data: locations, error: locationsError },
  ] = await Promise.all([
    c.db
      .from("inventory_items")
      .select("id,name,category,tracking_mode,unit_of_measure,is_active")
      .eq("department_id", c.departmentId)
      .in("id", itemIds),
    c.db
      .from("inventory_locations")
      .select("id,name,is_active")
      .eq("department_id", c.departmentId)
      .in("id", locationIds),
  ]);
  if (itemsError || locationsError)
    return NextResponse.json(
      {
        error:
          itemsError?.message ??
          locationsError?.message ??
          "Inventory could not be loaded.",
      },
      { status: 500 },
    );
  return NextResponse.json({
    balances: enrichInventoryBalances(
      balanceRows,
      items ?? [],
      locations ?? [],
    ),
  });
}
