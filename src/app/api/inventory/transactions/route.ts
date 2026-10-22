import { NextRequest, NextResponse } from "next/server";
import { getInventoryServerContext, idempotencyKey, inventoryDenied, inventoryRpcFailure, invalidIdempotencyKey, nullableText, quantity, text } from "@/lib/tracepoint/inventory-server";
export const dynamic = "force-dynamic";
const types=new Set(["receive","adjust","transfer"]);
export async function GET(){const c=await getInventoryServerContext();if("error" in c)return c.error;if(!c.canView)return inventoryDenied("view");const {data,error}=await c.db.from("inventory_transactions").select("*").eq("department_id",c.departmentId).order("created_at",{ascending:false}).limit(100);return error?NextResponse.json({error:error.message},{status:500}):NextResponse.json({transactions:data??[]});}
export async function POST(request:NextRequest){
  const c=await getInventoryServerContext();if("error" in c)return c.error;if(!c.canAdjust)return inventoryDenied("adjust");
  const b=await request.json().catch(()=>({}));
  const itemId=text(b.itemId,100),transactionType=text(b.transactionType,20),amount=quantity(b.quantity),sourceLocationId=nullableText(b.sourceLocationId,100),destinationLocationId=nullableText(b.destinationLocationId,100),reason=nullableText(b.reason,1000),requestKey=idempotencyKey(b.idempotencyKey);
  if(!requestKey.ok)return invalidIdempotencyKey();
  if(!itemId||!types.has(transactionType)||!Number.isFinite(amount)||amount===0)return NextResponse.json({error:"Item, transaction type, and a nonzero quantity are required."},{status:400});
  // D-70: an issue (negative) or a count correction changes on-hand without a
  // movement, so the ledger row must say why.
  if(transactionType==="adjust"&&!reason)return NextResponse.json({error:"A reason is required to issue stock or correct a count."},{status:400});
  // D-65: the request key makes a resubmitted movement return the first one.
  const {data,error}=await c.db.rpc("record_inventory_transaction",{p_item_id:itemId,p_transaction_type:transactionType,p_quantity:amount,p_source_location_id:sourceLocationId,p_destination_location_id:transactionType==="adjust"?null:destinationLocationId,p_reason:reason,p_reference:nullableText(b.reference,250),p_idempotency_key:requestKey.key});
  return error?inventoryRpcFailure(error,"below zero"):NextResponse.json({transaction:data},{status:201});
}
