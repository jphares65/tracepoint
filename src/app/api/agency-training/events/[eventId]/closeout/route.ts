import { NextRequest, NextResponse } from "next/server";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

type RouteContext = { params: Promise<{ eventId: string }> };
const MANAGE = ["manage_training", "manage_certifications", "manage_range_days"] as const;

export async function POST(_request: NextRequest, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  if (!hasAnyServerPermission(context, MANAGE)) {
    return permissionDeniedResponse("Training-management permission is required to complete an event.");
  }
  const { eventId } = await routeContext.params;
  const result = await context.admin.rpc("close_agency_training_event", {
    p_department_id: context.departmentId,
    p_event_id: eventId,
    p_actor_user_id: context.userId,
  });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  return NextResponse.json({ closeout: result.data });
}