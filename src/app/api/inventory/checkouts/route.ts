import { NextRequest, NextResponse } from "next/server";
import {
  getInventoryServerContext,
  inventoryDenied,
  nullableText,
  quantity,
  text,
} from "@/lib/tracepoint/inventory-server";
export const dynamic = "force-dynamic";

type CheckoutReturn = { quantity: number | string | null };
type CheckoutRow = {
  quantity: number | string | null;
  inventory_checkout_returns: CheckoutReturn[] | null;
  closed_at: string | null;
  due_at: string | null;
  [key: string]: unknown;
};
export async function GET(request: NextRequest) {
  const c = await getInventoryServerContext();
  if ("error" in c) return c.error;
  if (!c.canView) return inventoryDenied("view");
  const history = request.nextUrl.searchParams.get("history") === "true";
  let q = c.db
    .from("inventory_checkouts")
    .select(
      "*,inventory_checkout_returns(quantity,returned_at,returned_by,reason,reference)",
    )
    .eq("department_id", c.departmentId)
    .order("checked_out_at", { ascending: false });
  if (!history) q = q.is("closed_at", null);
  const { data, error } = await q;
  return error
    ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({
        checkouts: ((data ?? []) as CheckoutRow[]).map((x) => ({
          ...x,
          outstanding_quantity:
            Number(x.quantity) -
            (x.inventory_checkout_returns ?? []).reduce(
              (n, r) => n + Number(r.quantity),
              0,
            ),
          overdue:
            !x.closed_at && !!x.due_at && new Date(x.due_at) < new Date(),
        })),
      });
}
export async function POST(request: NextRequest) {
  const c = await getInventoryServerContext();
  if ("error" in c) return c.error;
  if (!c.canAdjust) return inventoryDenied("adjust");
  const b = await request.json().catch(() => ({})),
    itemId = text(b.itemId, 100),
    locationId = text(b.locationId, 100),
    recipientType = text(b.recipientType, 20),
    amount = quantity(b.quantity);
  if (!itemId || !locationId || !Number.isFinite(amount))
    return NextResponse.json(
      { error: "Item, location, and quantity are required." },
      { status: 400 },
    );
  const { data, error } = await c.db.rpc("checkout_inventory", {
    p_item_id: itemId,
    p_location_id: locationId,
    p_recipient_type: recipientType,
    p_recipient_user_id: nullableText(b.recipientUserId, 100),
    p_recipient_unit: nullableText(b.recipientUnit, 150),
    p_recipient_vehicle_id: nullableText(b.recipientVehicleId, 100),
    p_quantity: amount,
    p_due_at: nullableText(b.dueAt, 60),
    p_reason: nullableText(b.reason, 1000),
    p_reference: nullableText(b.reference, 250),
  });
  return error
    ? NextResponse.json(
        { error: error.message },
        { status: error.message.includes("exceeds") ? 409 : 400 },
      )
    : NextResponse.json({ checkout: data }, { status: 201 });
}
