import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type PasswordResetRequest = {
  departmentId?: string;
  email?: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function findUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
) {
  const target = email.toLowerCase();

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 100,
    });

    if (error) throw error;

    const match = data.users.find(
      (user) => user.email?.toLowerCase() === target,
    );

    if (match) return match;
    if (data.users.length < 100) break;
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PasswordResetRequest;

    const departmentId = cleanText(body.departmentId);
    const email = cleanText(body.email).toLowerCase();

    if (!departmentId || !email) {
      return NextResponse.json(
        { error: "Department and email are required." },
        { status: 400 },
      );
    }

    const server = await createServerClient();

    const {
      data: { user: actor },
      error: actorError,
    } = await server.auth.getUser();

    if (actorError || !actor) {
      return NextResponse.json(
        { error: "Authentication is required." },
        { status: 401 },
      );
    }

    const [manageResult, administerResult] = await Promise.all([
      server.rpc("has_department_permission", {
        p_department_id: departmentId,
        p_permission_code: "manage_users",
      }),
      server.rpc("has_department_permission", {
        p_department_id: departmentId,
        p_permission_code: "administer_department",
      }),
    ]);

    if (manageResult.error) throw manageResult.error;
    if (administerResult.error) throw administerResult.error;

    const canManage = Boolean(manageResult.data);
    const canAdminister = Boolean(administerResult.data);

    if (!canManage && !canAdminister) {
      return NextResponse.json(
        { error: "You do not have permission to manage users." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();

    const targetUser = await findUserByEmail(admin, email);

    if (!targetUser) {
      return NextResponse.json(
        { error: "No TracePoint account was found for that email address." },
        { status: 404 },
      );
    }

    const { data: membership, error: membershipError } = await admin
      .from("department_memberships")
      .select("department_id, user_id, is_active")
      .eq("department_id", departmentId)
      .eq("user_id", targetUser.id)
      .maybeSingle();

    if (membershipError) throw membershipError;

    if (!membership) {
      return NextResponse.json(
        { error: "That user is not a member of this department." },
        { status: 404 },
      );
    }

    const { data: targetRoles, error: targetRolesError } = await admin
      .from("department_membership_roles")
      .select("role_code")
      .eq("department_id", departmentId)
      .eq("user_id", targetUser.id);

    if (targetRolesError) throw targetRolesError;

    const targetIsAdministrator = (targetRoles ?? []).some(
      (row) => row.role_code === "administrator",
    );

    if (targetIsAdministrator && !canAdminister) {
      return NextResponse.json(
        {
          error:
            "Only a department Administrator may send a password reset to another Administrator.",
        },
        { status: 403 },
      );
    }

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
      request.nextUrl.origin;

    const { error: resetError } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(
        "/auth/setup",
      )}`,
    });

    if (resetError) throw resetError;

    const { error: auditError } = await admin.from("audit_events").insert({
      department_id: departmentId,
      actor_user_id: actor.id,
      action: "password_reset_sent",
      entity_type: "department_membership",
      entity_id: targetUser.id,
      summary: `Password reset sent to ${email}.`,
      new_value: {
        email,
      },
    });

    if (auditError) throw auditError;

    return NextResponse.json({
      ok: true,
      message: `Password reset sent to ${email}.`,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The password reset could not be sent.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}