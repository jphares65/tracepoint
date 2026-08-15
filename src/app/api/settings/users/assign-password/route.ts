import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type AssignPasswordRequest = {
  departmentId?: string;
  userId?: string;
  password?: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AssignPasswordRequest;

    const departmentId = cleanText(body.departmentId);
    const targetUserId = cleanText(body.userId);
    const password =
      typeof body.password === "string" ? body.password : "";

    if (!departmentId || !targetUserId || !password) {
      return NextResponse.json(
        {
          error: "Department, user, and password are required.",
        },
        { status: 400 },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        {
          error: "Password must be at least 8 characters.",
        },
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
        {
          error: "Authentication is required.",
        },
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
        {
          error: "You do not have permission to manage users.",
        },
        { status: 403 },
      );
    }

    const admin = createAdminClient();

    /*
     * Verify that the selected user is an active member of the same
     * department supplied in the request.
     */
    const { data: membership, error: membershipError } = await admin
      .from("department_memberships")
      .select("department_id,user_id,is_active")
      .eq("department_id", departmentId)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (membershipError) throw membershipError;

    if (!membership) {
      return NextResponse.json(
        {
          error: "The selected user is not a member of this department.",
        },
        { status: 404 },
      );
    }

    if (!membership.is_active) {
      return NextResponse.json(
        {
          error: "A password cannot be assigned to an inactive member.",
        },
        { status: 400 },
      );
    }

    /*
     * A manage-users account cannot modify an Administrator account.
     * Only another department Administrator may do that.
     */
    const { data: targetRoles, error: targetRolesError } = await admin
      .from("department_membership_roles")
      .select("role_code")
      .eq("department_id", departmentId)
      .eq("user_id", targetUserId);

    if (targetRolesError) throw targetRolesError;

    const targetIsAdministrator = (targetRoles ?? []).some(
      (row) => row.role_code === "administrator",
    );

    if (targetIsAdministrator && !canAdminister) {
      return NextResponse.json(
        {
          error:
            "Only a department Administrator may assign a password to an Administrator account.",
        },
        { status: 403 },
      );
    }

    /*
     * Confirm that the Supabase Auth user actually exists before
     * attempting the password update.
     */
    const { data: targetUserResult, error: targetUserError } =
      await admin.auth.admin.getUserById(targetUserId);

    if (targetUserError || !targetUserResult.user) {
      return NextResponse.json(
        {
          error: "The selected Supabase Auth user could not be found.",
        },
        { status: 404 },
      );
    }

    const { error: updateError } =
      await admin.auth.admin.updateUserById(targetUserId, {
        password,
      });

    if (updateError) throw updateError;

    const targetEmail =
      targetUserResult.user.email ?? "the selected user";

    /*
     * Do not store the password—or any derivative of it—in the audit log.
     */
    const { error: auditError } = await admin
      .from("audit_events")
      .insert({
        department_id: departmentId,
        actor_user_id: actor.id,
        action: "user_password_assigned",
        entity_type: "auth_user",
        entity_id: targetUserId,
        summary: `An administrator assigned a new password to ${targetEmail}.`,
        new_value: {
          target_user_id: targetUserId,
          target_email: targetUserResult.user.email ?? null,
        },
      });

    if (auditError) throw auditError;

    return NextResponse.json({
      ok: true,
      message: `A new password was assigned to ${targetEmail}.`,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The password could not be assigned.";

    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}
