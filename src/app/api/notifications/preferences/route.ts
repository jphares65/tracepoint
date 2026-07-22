import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

async function context() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient() as any;
  const { data: membership } = await admin
    .from("department_memberships")
    .select("department_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  return membership?.department_id
    ? { user, admin, departmentId: String(membership.department_id) }
    : null;
}

export async function PUT(request: NextRequest) {
  const resolved = await context();
  if (!resolved) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

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
