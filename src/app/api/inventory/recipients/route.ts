import { NextResponse } from "next/server";
import { getInventoryServerContext, inventoryDenied } from "@/lib/tracepoint/inventory-server";
import { loadRecipientDirectory, recipientOptions } from "@/lib/inventory/recipient-directory";

export const dynamic = "force-dynamic";

// D-63: the checkout picker is authorized by Inventory, not by personnel or
// fleet permissions, so an adjuster can check stock out to anyone in the
// agency. Only holders the checkout function accepts are offered.
export async function GET() {
  const c = await getInventoryServerContext();
  if ("error" in c) return c.error;
  if (!c.canAdjust) return inventoryDenied("adjust");
  const directory = await loadRecipientDirectory(c.db);
  if ("error" in directory)
    return NextResponse.json({ error: "Recipients could not be loaded." }, { status: 500 });
  return NextResponse.json(recipientOptions(directory.rows));
}
