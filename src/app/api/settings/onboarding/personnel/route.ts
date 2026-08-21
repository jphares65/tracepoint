import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type PersonnelImportRequest = {
  departmentId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  badgeNumber?: string;
  rankTitle?: string;
  unitName?: string;
  employeeNumber?: string;
  active?: string | boolean;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isActiveValue(value: unknown) {
  if (typeof value === "boolean") return value;

  const normalized = cleanText(value).toLowerCase();

  if (!normalized) return true;

  return ![
    "no",
    "n",
    "false",
    "0",
    "inactive",
    "disabled",
    "terminated",
    "retired",
  ].includes(normalized);
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
    const body = (await request.json()) as PersonnelImportRequest;

    const departmentId = cleanText(body.departmentId);
    const firstName = cleanText(body.firstName);
    const lastName = cleanText(body.lastName);
    const fullName = `${firstName} ${lastName}`.trim();
    const email = cleanText(body.email).toLowerCase();
    const badgeNumber = cleanText(body.badgeNumber);
    const rankTitle = cleanText(body.rankTitle);
    const unitName = cleanText(body.unitName);
    const employeeNumber = cleanText(body.employeeNumber);
    const active = isActiveValue(body.active);

    if (!departmentId || !firstName || !lastName || !email || !badgeNumber) {
      return NextResponse.json(
        {
          error:
            "Department, first name, last name, email, and badge number are required.",
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
        { error: "You do not have permission to import personnel." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();

    let targetUser = await findUserByEmail(admin, email);
    let createdAuthUser = false;

    if (!targetUser) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          onboarding_status: "pending_activation",
        },
      });

      if (error) throw error;

      targetUser = data.user;
      createdAuthUser = true;
    }

    if (!targetUser) {
      throw new Error("Supabase did not return the created user.");
    }

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: targetUser.id,
        full_name: fullName,
        email,
      },
      { onConflict: "id" },
    );

    if (profileError) throw profileError;

    const { error: membershipError } = await admin
      .from("department_memberships")
      .upsert(
        {
          department_id: departmentId,
          user_id: targetUser.id,
          badge_number: badgeNumber,
          rank_title: rankTitle || null,
          unit_name: unitName || null,
          employee_number: employeeNumber || null,
          is_active: active,
          deactivated_at: active ? null : new Date().toISOString(),
          activation_status:
            createdAuthUser ||
            targetUser.user_metadata?.onboarding_status === "pending_activation"
              ? "pending_activation"
              : "activated",
        },
        { onConflict: "department_id,user_id" },
      );

    if (membershipError) throw membershipError;

    const { error: rolesError } = await server.rpc(
      "set_department_member_roles",
      {
        p_department_id: departmentId,
        p_user_id: targetUser.id,
        p_role_codes: ["officer"],
      },
    );

    if (rolesError) throw rolesError;

    const { error: auditError } = await admin.from("audit_events").insert({
      department_id: departmentId,
      actor_user_id: actor.id,
      action: createdAuthUser
        ? "personnel_imported_pending_activation"
        : "existing_user_added_by_personnel_import",
      entity_type: "department_membership",
      entity_id: targetUser.id,
      summary: createdAuthUser
        ? `${fullName} imported as personnel pending account activation.`
        : `${fullName} added from personnel import using an existing TracePoint account.`,
      new_value: {
        email,
        full_name: fullName,
        badge_number: badgeNumber,
        rank_title: rankTitle || null,
        unit_name: unitName || null,
        is_active: active,
        activation_email_sent: false,
      },
    });

    if (auditError) throw auditError;

    return NextResponse.json({
      ok: true,
      userId: targetUser.id,
      createdAuthUser,
      activationEmailSent: false,
      message: createdAuthUser
        ? `${fullName} imported pending activation.`
        : `${fullName} added using an existing TracePoint account.`,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The personnel record could not be imported.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}


