import {configuredSiteOrigin} from '@/lib/authentication/redirects';
import { NextRequest, NextResponse } from "next/server";

import { issueActivationEmail } from "@/lib/tracepoint/activation";
import { provisionExistingCognitoUser } from "@/lib/authentication/cognito-existing-user-migration";
import { accessFailureResponse, hasServerPermission, resolveServerAccess } from "@/lib/tracepoint/server-access";

type ActivationRequest = {
  departmentId?: string;
  userId?: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}


export async function POST(request: NextRequest) {
  try {
    const siteUrl = configuredSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
    const body = (await request.json()) as ActivationRequest;

    const departmentId = cleanText(body.departmentId);
    const userId = cleanText(body.userId);

    if (!departmentId || !userId) {
      return NextResponse.json(
        { error: "Department and user are required." },
        { status: 400 },
      );
    }

    if (process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native") {
      const access = await resolveServerAccess();
      if (!access.ok) return accessFailureResponse(access);
      if (access.context.departmentId !== departmentId) return NextResponse.json({ error: "The active agency does not match this request." }, { status: 403 });
      if (!hasServerPermission(access.context, "manage_users")) return NextResponse.json({ error: "You do not have permission to activate users." }, { status: 403 });
      const [membershipResult, profileResult, identityResult] = await Promise.all([
        access.context.admin.from("department_memberships").select("user_id,activation_status,is_active").eq("department_id", departmentId).eq("user_id", userId).maybeSingle(),
        access.context.admin.from("profiles").select("email,full_name").eq("id", userId).maybeSingle(),
        access.context.admin.from("authentication_identity_links").select("state").eq("tracepoint_user_id", userId).eq("provider", "cognito").maybeSingle(),
      ]);
      if (membershipResult.error || profileResult.error || identityResult.error) throw new Error("Activation account lookup failed.");
      const membership = membershipResult.data;
      if (!membership) return NextResponse.json({ error: "Department membership was not found." }, { status: 404 });
      if (!membership.is_active) return NextResponse.json({ error: "Inactive users cannot be activated." }, { status: 400 });
      const email = cleanText(profileResult.data?.email).toLowerCase();
      if (!email) return NextResponse.json({ error: "This user does not have an email address." }, { status: 400 });
      const identityState = cleanText(identityResult.data?.state);
      if (!identityState) {
        if (!hasServerPermission(access.context, "administer_department")) {
          return NextResponse.json({ error: "Department-administration permission is required to migrate an existing identity." }, { status: 403 });
        }
        await provisionExistingCognitoUser({
          actorUserId: access.context.userId,
          departmentId,
          targetUserId: userId,
          siteUrl,
        });
        return NextResponse.json({ ok: true, message: `Activation email sent to ${email}.` });
      }
      if (identityState !== "pending") {
        return NextResponse.json({ error: "This account does not require activation." }, { status: 400 });
      }
      const activation = await issueActivationEmail({ departmentId, userId, email, fullName: cleanText(profileResult.data?.full_name) || email, siteUrl, actorUserId: access.context.userId });
      const deliveryResult = await access.context.admin.rpc("record_cognito_activation_delivery", {
        p_department_id: departmentId,
        p_target_user_id: userId,
        p_token_id: activation.tokenId,
        p_expires_at: activation.expiresAt,
      });
      if (deliveryResult.error) throw new Error("Activation delivery persistence failed.");
      return NextResponse.json({ ok: true, message: `Activation email sent to ${email}.` });
    }

    const server = await (await import("@/lib/supabase/server")).createClient();

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

    const admin = (await import("@/lib/supabase/admin")).createAdminClient();

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


    const activation = await issueActivationEmail({
      departmentId,
      userId,
      email,
      fullName:
        cleanText(targetUser.user?.user_metadata?.full_name) ||
        email,
      siteUrl,
      actorUserId: actor.id,
    });

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
        activation_expires_at: activation.expiresAt,
        activation_token_id: activation.tokenId,
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


