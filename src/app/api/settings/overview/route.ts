import { NextResponse } from "next/server";
import { createSettingsOverviewRepository } from "@/lib/settings/overview-repository";
import { accessFailureResponse, hasAnyServerPermission, resolveServerAccess } from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  const canManageUsers = hasAnyServerPermission(context, ["manage_users", "administer_department"]);
  const canViewSecurity = hasAnyServerPermission(context, ["administer_department"]);
  try {
    const overview = await createSettingsOverviewRepository(context.db, context.admin, context.departmentId).getOverview({
      departmentId: context.departmentId,
      canViewSecurity,
      includeSupportMembers: canManageUsers && context.isSupportMode,
    });
    let members = overview.members;
    if (canManageUsers && !context.isSupportMode) {
      const result = await context.db.rpc("get_department_members", { p_department_id: context.departmentId });
      if (result.error) return NextResponse.json({ error: typeof result.error.message === "string" ? result.error.message : "Settings could not be loaded." }, { status: 500 });
      members = result.data ?? [];
    }
    return NextResponse.json({ ...overview, members });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Settings could not be loaded." }, { status: 500 });
  }
}
