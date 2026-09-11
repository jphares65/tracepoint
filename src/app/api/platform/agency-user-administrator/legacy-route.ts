import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RequestBody = {
  departmentId?: string;
  userId?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;

    const departmentId = body.departmentId?.trim() ?? "";
    const userId = body.userId?.trim() ?? "";

    if (!departmentId || !userId) {
      return NextResponse.json(
        { error: "Department and user are required." },
        { status: 400 },
      );
    }

    const server = await createClient();

    const {
      data: { user: actor },
    } = await server.auth.getUser();

    if (!actor) {
      return NextResponse.json(
        { error: "Authentication is required." },
        { status: 401 },
      );
    }

    const { data: isPlatformAdmin, error: platformError } =
      await server.rpc("is_platform_admin");

    if (platformError) throw platformError;

    if (!isPlatformAdmin) {
      return NextResponse.json(
        { error: "Platform administrator access is required." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();

    const { data: membership, error: membershipError } =
      await admin
        .from("department_memberships")
        .select("user_id")
        .eq("department_id", departmentId)
        .eq("user_id", userId)
        .maybeSingle();

    if (membershipError) throw membershipError;

    if (!membership) {
      return NextResponse.json(
        { error: "Department membership was not found." },
        { status: 404 },
      );
    }

    const { error: roleError } = await server.rpc(
      "set_department_member_roles",
      {
        p_department_id: departmentId,
        p_user_id: userId,
        p_role_codes: ["officer", "administrator"],
      },
    );

    if (roleError) throw roleError;

    const { error: auditError } = await admin
      .from("audit_events")
      .insert({
        department_id: departmentId,
        actor_user_id: actor.id,
        action: "platform_administrator_role_assigned",
        entity_type: "department_membership",
        entity_id: userId,
        summary: "Administrator role assigned by TracePoint platform administration.",
        new_value: {
          role_codes: ["officer", "administrator"],
        },
      });

    if (auditError) throw auditError;

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Administrator role could not be assigned.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}