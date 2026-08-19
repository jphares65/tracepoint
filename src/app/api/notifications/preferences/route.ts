import { NextRequest, NextResponse } from "next/server";

import { resolveServerAccess } from "@/lib/tracepoint/server-access";


export async function PUT(request: NextRequest) {
  const access = await resolveServerAccess();

  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }

  const resolved = access.context;

  const body = await request.json().catch(() => ({})) as any;
  const digest = body.digest_mode === "Daily" || body.digest_mode === "Weekly" ? body.digest_mode : "Immediate";

  const { error } = await resolved.admin.from("notification_preferences").upsert({
    department_id: resolved.departmentId,
    user_id: resolved.user.id,
    in_app_enabled: body.in_app_enabled !== false,
    email_enabled: body.email_enabled === true,
    critical_email_only: body.critical_email_only !== false,
    digest_mode: digest,
    source_preferences: body.source_preferences && typeof body.source_preferences === "object" ? body.source_preferences : {},
    updated_at: new Date().toISOString(),
  }, { onConflict: "department_id,user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

