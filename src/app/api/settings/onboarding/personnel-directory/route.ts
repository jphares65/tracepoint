import { NextRequest, NextResponse } from "next/server";

import { createAdministrationReadRepository } from "@/lib/administration/read-repository";
import { accessFailureResponse, hasAnyServerPermission, resolveServerAccess } from "@/lib/tracepoint/server-access";

export async function GET(request: NextRequest) {
  try {
    const departmentId =
      request.nextUrl.searchParams.get("departmentId")?.trim() ?? "";

    if (!departmentId) {
      return NextResponse.json(
        { error: "Department is required." },
        { status: 400 },
      );
    }

    const access = await resolveServerAccess();
    if (!access.ok) return accessFailureResponse(access);
    if (access.context.departmentId !== departmentId) {
      return NextResponse.json({ error: "The active agency does not match this request." }, { status: 403 });
    }
    if (!hasAnyServerPermission(access.context, ["manage_users", "administer_department"])) {
      return NextResponse.json(
        { error: "You do not have permission to view personnel." },
        { status: 403 },
      );
    }

    const admin = access.context.admin;

    const memberships = await createAdministrationReadRepository(admin, departmentId).listPersonnel(departmentId);

    const personnel = (memberships ?? []).map((membership) => {
      const profile = Array.isArray(membership.profiles)
        ? membership.profiles[0]
        : membership.profiles;

      const fullName = profile?.full_name ?? "";

      return {
        id: membership.user_id,
        userId: membership.user_id,
        displayName: fullName,
        fullName,
        email: profile?.email ?? null,
        badgeNumber: membership.badge_number ?? null,
        rankTitle: membership.rank_title ?? null,
      };
    });

    return NextResponse.json({ personnel });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Personnel directory could not be loaded.";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
