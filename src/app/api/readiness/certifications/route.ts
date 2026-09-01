import { NextResponse } from "next/server";
import { createReadinessRepository } from "@/lib/readiness/read-repository";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
export async function GET() {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  if (!hasAnyServerPermission(context, ["manage_certifications", "view_command_dashboard", "view_analytics"])) {
    return permissionDeniedResponse("You do not have permission to view department certification readiness.");
  }
  try {
    const result = await createReadinessRepository(context.admin, context.departmentId).getCertificationReadiness({ departmentId: context.departmentId });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Certification readiness could not be loaded." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
