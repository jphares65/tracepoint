import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type ActivationRequest = {
  departmentId?: string;
  userId?: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getRequestOrigin(request: NextRequest) {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (configuredSiteUrl) {
    return configuredSiteUrl.replace(/\/$/, "");
  }

  return request.nextUrl.origin.replace(/\/$/, "");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ActivationRequest;

    const departmentId = cleanText(body.departmentId);
    const userId = cleanText(body.userId);

    if (!departmentId || !userId) {
      return NextResponse.json(
        { error: "Department and user are required." },
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

    const [manageResult, administerResult, platformAdminResult] = await Promise.all([
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
        { error: "You do not have permission to activate users." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();

    const { data: membership, error: membershipError } = await admin
      .from("department_memberships")
      .select("user_id,activation_status,is_active")
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

    if (!membership.is_active) {
      return NextResponse.json(
        { error: "Inactive users cannot be activated." },
        { status: 400 },
      );
    }

    if (
      membership.activation_status !== "pending_activation" &&
      membership.activation_status !== "activation_sent"
    ) {
      return NextResponse.json(
        { error: "This account does not require activation." },
        { status: 400 },
      );
    }

    const { data: targetUser, error: userError } =
      await admin.auth.admin.getUserById(userId);

    if (userError) throw userError;

    const email = targetUser.user?.email?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json(
        { error: "This user does not have an email address." },
        { status: 400 },
      );
    }

    const siteUrl = getRequestOrigin(request);

    const { error: resetError } =
      await admin.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(
          "/auth/setup",
        )}`,
      });

    if (resetError) throw resetError;

    const { error: statusError } = await admin
      .from("department_memberships")
      .update({
        activation_status: "activation_sent",
      })
      .eq("department_id", departmentId)
      .eq("user_id", userId);

    if (statusError) throw statusError;

    const { error: auditError } = await admin.from("audit_events").insert({
      department_id: departmentId,
      actor_user_id: actor.id,
      action: "activation_email_sent",
      entity_type: "department_membership",
      entity_id: userId,
      summary: `Activation email sent to ${email}.`,
      new_value: {
        activation_status: "activation_sent",
        email,
      },
    });

    if (auditError) throw auditError;

    return NextResponse.json({
      ok: true,
      message: `Activation email sent to ${email}.`,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Activation email could not be sent.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}


