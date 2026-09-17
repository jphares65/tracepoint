import { NextResponse } from "next/server";
import { createReadinessRepository } from "@/lib/readiness/read-repository";
import { accessFailureResponse, hasAnyServerPermission, requireServerFeature, resolveServerAccess } from "@/lib/tracepoint/server-access";
export const dynamic = "force-dynamic";
export async function GET() {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  const featureError = requireServerFeature(context, "equipment_readiness", "Equipment Readiness");
  if (featureError) return featureError;
  const canViewDepartment = hasAnyServerPermission(context, ["manage_equipment", "administer_department", "view_command_dashboard", "view_analytics"]);
  try {
    const result = await createReadinessRepository(context.db, context.departmentId).getEquipmentReadiness({ departmentId: context.departmentId, userId: context.userId, canViewDepartment });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Equipment readiness could not be loaded." }, { status: 500 });
  }
}
