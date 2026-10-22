import { NextRequest, NextResponse } from "next/server";
import { getInventoryServerContext, idempotencyKey, inventoryDenied, inventoryRpcFailure, invalidIdempotencyKey, nullableText, quantity, text } from "@/lib/tracepoint/inventory-server";
import { checkoutRecipientLabel, loadRecipientDirectory } from "@/lib/inventory/recipient-directory";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
  const c=await getInventoryServerContext();if("error" in c)return c.error;if(!c.canView)return inventoryDenied("view");
  const history=request.nextUrl.searchParams.get("history")==="true";
  let q=c.db.from("inventory_checkouts").select("*,inventory_checkout_returns(quantity,returned_at,returned_by,reason,reference)").eq("department_id",c.departmentId).order("checked_out_at",{ascending:false});
  if(!history)q=q.is("closed_at",null);
  const [{data,error},directory]=await Promise.all([q,loadRecipientDirectory(c.db)]);
  if(error)return NextResponse.json({error:error.message},{status:500});
  // D-62: the holder is named server-side; the identifiers stay for linking.
  const people="rows" in directory?directory.rows:[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return NextResponse.json({checkouts:(data??[]).map((x:any)=>({...x,inventory_checkout_returns:x.inventory_checkout_returns??[],recipient_label:checkoutRecipientLabel(x,people),outstanding_quantity:Number(x.quantity)-(x.inventory_checkout_returns??[]).reduce((n:number,r:any)=>n+Number(r.quantity),0),overdue:!x.closed_at&&!!x.due_at&&new Date(x.due_at)<new Date()}))});
}
export async function POST(request:NextRequest){
  const c=await getInventoryServerContext();if("error" in c)return c.error;if(!c.canAdjust)return inventoryDenied("adjust");
  const b=await request.json().catch(()=>({})),itemId=text(b.itemId,100),locationId=text(b.locationId,100),recipientType=text(b.recipientType,20),amount=quantity(b.quantity),requestKey=idempotencyKey(b.idempotencyKey);
  if(!requestKey.ok)return invalidIdempotencyKey();
  if(!itemId||!locationId||!Number.isFinite(amount))return NextResponse.json({error:"Item, location, and quantity are required."},{status:400});
  // D-65: the request key makes a resubmitted checkout return the first one.
  const {data,error}=await c.db.rpc("checkout_inventory",{p_item_id:itemId,p_location_id:locationId,p_recipient_type:recipientType,p_recipient_user_id:nullableText(b.recipientUserId,100),p_recipient_unit:nullableText(b.recipientUnit,150),p_recipient_vehicle_id:nullableText(b.recipientVehicleId,100),p_quantity:amount,p_due_at:nullableText(b.dueAt,60),p_reason:nullableText(b.reason,1000),p_reference:nullableText(b.reference,250),p_idempotency_key:requestKey.key});
  return error?inventoryRpcFailure(error,"exceeds"):NextResponse.json({checkout:data},{status:201});
}
