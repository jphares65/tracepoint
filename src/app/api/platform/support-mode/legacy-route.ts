import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function requirePlatformAdmin() {
  const server = await createClient();

  const {
    data: { user },
    error,
  } = await server.auth.getUser();

  if (error || !user) {
    return {
      ok: false as const,
      status: 401,
      error: "Authentication is required.",
    };
  }

  const { data: isPlatformAdmin, error: adminError } =
    await server.rpc("is_platform_admin");

  if (adminError || !isPlatformAdmin) {
    return {
      ok: false as const,
      status: 403,
      error: "Platform administrator access is required.",
    };
  }

  return { ok: true as const, user };
}

function clearSupportCookies(response: NextResponse) {
  for (const name of [
    "tracepoint_support_department_id",
    "tracepoint_department_id",
  ]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}

async function recordSupportModeEvent({
  admin,
  actorUserId,
  departmentId,
  departmentName,
  action,
}: {
  admin: any;
  actorUserId: string;
  departmentId: string;
  departmentName: string | null;
  action: "support_mode_entered" | "support_mode_exited";
}) {
  const { error } = await admin.from("audit_events").insert({
    department_id: departmentId,
    actor_user_id: actorUserId,
    action,
    entity_type: "department",
    entity_id: departmentId,
    details: {
      source: "platform_support_mode",
      support_mode: true,
      target_department_id: departmentId,
      target_department_name: departmentName,
    },
  });

  return error;
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformAdmin();

  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status },
    );
  }

  const body = await request.json().catch(() => ({}));

  const departmentId =
    typeof body.departmentId === "string"
      ? body.departmentId.trim()
      : "";

  if (!departmentId) {
    return NextResponse.json(
      { error: "departmentId is required." },
      { status: 400 },
    );
  }

  const admin = createAdminClient() as any;

  const { data: department, error } = await admin
    .from("departments")
    .select("id,name")
    .eq("id", departmentId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  if (!department) {
    return NextResponse.json(
      { error: "Agency was not found." },
      { status: 404 },
    );
  }

  const auditError = await recordSupportModeEvent({
    admin,
    actorUserId: auth.user.id,
    departmentId,
    departmentName: department.name,
    action: "support_mode_entered",
  });

  if (auditError) {
    return NextResponse.json(
      { error: `Support mode could not be audited: ${auditError.message}` },
      { status: 500 },
    );
  }

  const response = NextResponse.json({
    ok: true,
    departmentId,
    departmentName: department.name,
  });

  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  };

  response.cookies.set(
    "tracepoint_department_id",
    departmentId,
    cookieOptions,
  );

  response.cookies.set(
    "tracepoint_support_department_id",
    departmentId,
    cookieOptions,
  );

  return response;
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePlatformAdmin();

  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status },
    );
  }

  const departmentId =
    request.cookies
      .get("tracepoint_support_department_id")
      ?.value.trim() ?? "";

  let auditErrorMessage: string | null = null;

  if (departmentId) {
    const admin = createAdminClient() as any;

    const { data: department, error: departmentError } = await admin
      .from("departments")
      .select("id,name")
      .eq("id", departmentId)
      .maybeSingle();

    if (departmentError) {
      auditErrorMessage = departmentError.message;
    } else {
      const auditError = await recordSupportModeEvent({
        admin,
        actorUserId: auth.user.id,
        departmentId,
        departmentName: department?.name ?? null,
        action: "support_mode_exited",
      });

      auditErrorMessage = auditError?.message ?? null;
    }
  }

  const response = auditErrorMessage
    ? NextResponse.json(
        {
          error: `Support mode was ended, but the exit could not be audited: ${auditErrorMessage}`,
        },
        { status: 500 },
      )
    : NextResponse.json({ ok: true });

  return clearSupportCookies(response);
}
