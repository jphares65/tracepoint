import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type InviteRequest = {
  departmentId?: string;
  email?: string;
  fullName?: string;
  badgeNumber?: string;
  rankTitle?: string;
  unitName?: string;
  employeeNumber?: string;
  roleCodes?: string[];
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getRequestOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");

  if (origin) {
    return origin.replace(/\/$/, "");
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, "");
  }

  return request.nextUrl.origin.replace(/\/$/, "");
}

function uniqueRoleCodes(value: unknown) {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
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
    const body = (await request.json()) as InviteRequest;

    const departmentId = cleanText(body.departmentId);
    const email = cleanText(body.email).toLowerCase();
    const fullName = cleanText(body.fullName);
    const badgeNumber = cleanText(body.badgeNumber);
    const rankTitle = cleanText(body.rankTitle);
    const unitName = cleanText(body.unitName);
    const employeeNumber = cleanText(body.employeeNumber);
    const roleCodes = uniqueRoleCodes(body.roleCodes);

    if (!departmentId || !email || !fullName || roleCodes.length === 0) {
      return NextResponse.json(
        {
          error:
            "Department, email, full name, and at least one role are required.",
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

    if (roleCodes.includes("administrator") && !canAdminister) {
      return NextResponse.json(
        {
          error:
            "Only a department Administrator may assign the Administrator role.",
        },
        { status: 403 },
      );
    }

    const admin = createAdminClient();

    const { data: validRoles, error: validRolesError } = await admin
      .from("roles")
      .select("code")
      .in("code", roleCodes);

    if (validRolesError) throw validRolesError;

    const validRoleCodes = new Set(
      (validRoles ?? [])
        .map((row) => String(row.code ?? ""))
        .filter(Boolean),
    );

    if (
      roleCodes.length !== validRoleCodes.size ||
      roleCodes.some((roleCode) => !validRoleCodes.has(roleCode))
    ) {
      return NextResponse.json(
        { error: "One or more selected roles are invalid." },
        { status: 400 },
      );
    }

    let targetUser = await findUserByEmail(admin, email);
    let invitationSent = false;

    if (!targetUser) {
      const siteUrl = getRequestOrigin(request);

      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
        redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(
          "/auth/setup",
        )}`,
      });

      if (error) throw error;

      targetUser = data.user;
      invitationSent = true;
    }

    if (!targetUser) {
      throw new Error("Supabase did not return the invited user.");
    }

    const { data: existingRoles, error: existingRolesError } = await admin
      .from("department_membership_roles")
      .select("role_code")
      .eq("department_id", departmentId)
      .eq("user_id", targetUser.id);

    if (existingRolesError) throw existingRolesError;

    const targetIsAdministrator = (existingRoles ?? []).some(
      (row) => row.role_code === "administrator",
    );

    if (targetIsAdministrator && !canAdminister) {
      return NextResponse.json(
        {
          error:
            "Only a department Administrator may modify an Administrator account.",
        },
        { status: 403 },
      );
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
          badge_number: badgeNumber || null,
          rank_title: rankTitle || null,
          unit_name: unitName || null,
          employee_number: employeeNumber || null,
          is_active: true,
          deactivated_at: null,
        },
        { onConflict: "department_id,user_id" },
      );

    if (membershipError) throw membershipError;

    const { error: rolesError } = await server.rpc(
      "set_department_member_roles",
      {
        p_department_id: departmentId,
        p_user_id: targetUser.id,
        p_role_codes: roleCodes,
      },
    );

    if (rolesError) throw rolesError;

    const { error: auditError } = await admin.from("audit_events").insert({
      department_id: departmentId,
      actor_user_id: actor.id,
      action: invitationSent ? "user_invited" : "user_added",
      entity_type: "department_membership",
      entity_id: targetUser.id,
      summary: invitationSent
        ? `Invitation sent to ${email}.`
        : `Existing TracePoint user ${email} added to the department.`,
      new_value: {
        email,
        full_name: fullName,
        role_codes: roleCodes,
      },
    });

    if (auditError) throw auditError;

    return NextResponse.json({
      ok: true,
      invitationSent,
      message: invitationSent
        ? `Invitation sent to ${email}.`
        : `${email} was added using an existing TracePoint account.`,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The user could not be added.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}