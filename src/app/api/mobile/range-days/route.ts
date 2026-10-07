import { NextResponse } from "next/server";
import { accessFailureResponse, hasAnyServerPermission, hasServerFeature, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { createRangeReadRepository } from "@/lib/range/read-repository";
import { rangeDayPayload } from "@/lib/tracepoint/mobile-workflows";
export const dynamic = "force-dynamic";
export async function GET() {
  const resolved = await resolveServerAccess(); if (!resolved.ok) return accessFailureResponse(resolved);
  if (!hasServerFeature(resolved.context, "range_training") && !hasServerFeature(resolved.context, "qualifications")) return NextResponse.json({ error: "Range & Training is not enabled for this agency." }, { status: 403 });
  if (!hasAnyServerPermission(resolved.context, ["manage_range_days", "score_range_days", "manage_qualifications"])) return NextResponse.json({ error: "You are not authorized to view Range Days." }, { status: 403 });
  try { const data = await createRangeReadRepository(resolved.context.admin, resolved.context.departmentId).getWorkspace(resolved.context.departmentId); return NextResponse.json({ rangeDays: rangeDayPayload(data.workspace) }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Range Days could not be loaded." }, { status: 500 }); }
}
