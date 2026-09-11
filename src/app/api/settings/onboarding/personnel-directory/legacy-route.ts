import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdministrationReadRepository } from "@/lib/administration/read-repository";

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

    const server = await createServerClient();

    const {
      data: { user },
      error: userError,
    } = await server.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Authentication is required." },
        { status: 401 },
      );
    }

    const [manageResult, administerResult, platformAdminResult] =
      await Promise.all([
        server.rpc("has_department_permission", {
          p_department_id: departmentId,
          p_permission_code: "manage_users",
        }),
        server.rpc("has_department_permission", {
          p_department_id: departmentId,
          p_permission_code: "administer_department",
        }),
        server.rpc("is_platform_admin"),
      ]);

    if (manageResult.error) throw manageResult.error;
    if (administerResult.error) throw administerResult.error;
    if (platformAdminResult.error) throw platformAdminResult.error;

    if (
      !manageResult.data &&
      !administerResult.data &&
      !platformAdminResult.data
    ) {
      return NextResponse.json(
        { error: "You do not have permission to view personnel." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();

    const memberships = await createAdministrationReadRepository(admin as any, departmentId).listPersonnel(departmentId);

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
