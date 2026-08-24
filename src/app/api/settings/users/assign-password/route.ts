import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasServerPermission,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

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

    const access = await resolveServerAccess();

    if (!access.ok) {
      return accessFailureResponse(access);
    }

    const { context } = access;

    if (context.departmentId !== departmentId) {
      return NextResponse.json(
        {
          error:
            "The selected department does not match the active agency.",
        },
        { status: 403 },
      );
    }

    const canManage = hasServerPermission(
      context,
      "manage_users",
    );

    const canAdminister = hasServerPermission(
      context,
      "administer_department",
    );

    if (!canManage) {
      return NextResponse.json(
        {
          error: "You do not have permission to manage users.",
        },
        { status: 403 },
      );
    }

    const actor = context.user;
    const admin = context.admin;

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
      (row: { role_code?: string | null }) => row.role_code === "administrator",
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

    const assignedAt = new Date().toISOString();

    const existingMetadata =
      targetUserResult.user.user_metadata &&
      typeof targetUserResult.user.user_metadata === "object"
        ? targetUserResult.user.user_metadata
        : {};

    const { error: updateError } =
      await admin.auth.admin.updateUserById(targetUserId, {
        password,
        email_confirm: true,
        user_metadata: {
          ...existingMetadata,
          activation_status: "activated",
          activated_at: assignedAt,
        },
      });

    if (updateError) throw updateError;

    const { error: activationStatusError } = await admin
      .from("department_memberships")
      .update({
        activation_status: "activated",
      })
      .eq("department_id", departmentId)
      .eq("user_id", targetUserId);

    if (activationStatusError) throw activationStatusError;

    const { error: tokenRevokeError } = await admin
      .from("user_activation_tokens")
      .update({
        revoked_at: assignedAt,
      })
      .eq("department_id", departmentId)
      .eq("user_id", targetUserId)
      .is("used_at", null)
      .is("revoked_at", null);

    if (tokenRevokeError) throw tokenRevokeError;

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
          activation_status: "activated",
          support_mode: context.isSupportMode,
          platform_administrator: context.isSuperAdmin,
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
