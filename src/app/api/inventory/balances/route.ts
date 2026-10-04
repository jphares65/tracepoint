import { NextRequest, NextResponse } from "next/server";
import { getInventoryServerContext, inventoryDenied, text } from "@/lib/tracepoint/inventory-server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const c=await getInventoryServerContext(); if("error" in c)return c.error; if(!c.canView)return inventoryDenied("view");
  const locationId=text(request.nextUrl.searchParams.get("locationId"),100);
  let query=c.db.from("inventory_balances").select("id,inventory_item_id,inventory_location_id,on_hand_quantity,updated_at,inventory_items(id,name,category,tracking_mode,unit_of_measure,is_active),inventory_locations(id,name,is_active)").eq("department_id",c.departmentId).order("updated_at",{ascending:false});
  if(locationId) query=query.eq("inventory_location_id",locationId);
  const {data,error}=await query; return error?NextResponse.json({error:error.message},{status:500}):NextResponse.json({balances:data??[]});
}
