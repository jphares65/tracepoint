import { NextRequest, NextResponse } from "next/server";
import { createReadinessRepository } from "@/lib/readiness/read-repository";
import { accessFailureResponse, hasAnyServerPermission, requireServerFeature, resolveServerAccess } from "@/lib/tracepoint/server-access";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  const featureError = requireServerFeature(context, "equipment_readiness", "Equipment Readiness");
  if (featureError) return featureError;
  const canViewDepartment = hasAnyServerPermission(context, ["manage_equipment", "administer_department", "view_command_dashboard", "view_analytics"]);
  const operationalScope = request.nextUrl.searchParams.get("scope") === "operational";
  try {
    const result = await createReadinessRepository(context.db, context.departmentId).getEquipmentReadiness({
      departmentId: context.departmentId,
      userId: context.userId,
      canViewDepartment: operationalScope ? false : canViewDepartment,
    });

    if (!operationalScope) {
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    const poolResult = await context.admin
      .from("equipment_assets")
      .select("id,equipment_type_id,manufacturer,model,serial_number,asset_number,assigned_location,lifecycle_status")
      .eq("department_id", context.departmentId)
      .is("assigned_user_id", null)
      .is("assigned_vehicle_id", null)
      .eq("lifecycle_status", "out_of_service");

    if (poolResult.error) throw new Error(poolResult.error.message);

    return NextResponse.json(
      {
        ...result,
        scope: "self_and_pool",
        poolAssets: poolResult.data ?? [],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Equipment readiness could not be loaded." }, { status: 500 });
  }
}
