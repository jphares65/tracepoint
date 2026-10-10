import { NextResponse } from "next/server";
import { accessFailureResponse, hasAnyServerPermission, resolveServerAccess } from "@/lib/tracepoint/server-access";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const resolved = await resolveServerAccess(request);
  if (!resolved.ok) return accessFailureResponse(resolved);
  const ctx = resolved.context;
  if (!hasAnyServerPermission(ctx, ["view_inventory", "manage_inventory", "adjust_inventory"])) return NextResponse.json({ error: "Inventory access is not authorized." }, { status: 403 });
  // Schema typing may lag the inventory rollout; the authenticated tenant context owns these reads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = ctx.db as any;
  const [items, balances, locations] = await Promise.all([
    db.from("inventory_items").select("id,name,category,sku,tracking_mode,unit_of_measure,is_active").eq("department_id", ctx.departmentId).order("name"),
    db.from("inventory_balances").select("id,inventory_item_id,inventory_location_id,on_hand_quantity").eq("department_id", ctx.departmentId),
    db.from("inventory_locations").select("id,name").eq("department_id", ctx.departmentId),
  ]);
  if (items.error || balances.error || locations.error) return NextResponse.json({ error: "Inventory is temporarily unavailable." }, { status: 500 });
  const loc = new Map<string, { id: string; name: string }>((locations.data ?? []).map((v: { id: string; name: string }) => [v.id, { id: v.id, name: v.name }]));
  return NextResponse.json({ items: items.data ?? [], balances: (balances.data ?? []).map((b: { inventory_location_id: string }) => ({ ...b, inventory_locations: loc.get(b.inventory_location_id) ?? null })) }, { headers: { "Cache-Control": "no-store" } });
}
