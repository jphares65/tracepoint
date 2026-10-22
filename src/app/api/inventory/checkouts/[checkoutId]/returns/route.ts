import { NextRequest, NextResponse } from "next/server";
import { getInventoryServerContext, idempotencyKey, inventoryDenied, inventoryRpcFailure, invalidIdempotencyKey, nullableText, quantity } from "@/lib/tracepoint/inventory-server";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest,{params}:{params:Promise<{checkoutId:string}>}){
  const c=await getInventoryServerContext();if("error" in c)return c.error;if(!c.canAdjust)return inventoryDenied("adjust");
  const b=await request.json().catch(()=>({})),id=(await params).checkoutId,amount=quantity(b.quantity),requestKey=idempotencyKey(b.idempotencyKey);
  if(!requestKey.ok)return invalidIdempotencyKey();
  if(!id||!Number.isFinite(amount))return NextResponse.json({error:"Checkout and return quantity are required."},{status:400});
  // D-65: a resubmitted return is recorded once.
  const {data,error}=await c.db.rpc("return_inventory_checkout",{p_checkout_id:id,p_quantity:amount,p_reason:nullableText(b.reason,1000),p_reference:nullableText(b.reference,250),p_idempotency_key:requestKey.key});
  return error?inventoryRpcFailure(error,"exceeds"):NextResponse.json({checkout:data});
}
