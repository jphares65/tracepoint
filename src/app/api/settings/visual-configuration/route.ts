import { NextRequest, NextResponse } from "next/server";

import { mergeAnalyticsDashboardConfiguration, normalizeAnalyticsDashboardConfiguration } from "@/lib/tracepoint/analytics-dashboard-config";
import { accessFailureResponse, hasServerPermission, resolveServerAccess } from "@/lib/tracepoint/server-access";

export async function POST(request: NextRequest) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasServerPermission(access.context, "administer_department")) {
    return NextResponse.json({ error: "Department-administration permission is required." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const departmentId = typeof body.departmentId === "string" ? body.departmentId.trim() : "";
  if (!departmentId || departmentId !== access.context.departmentId) {
    return NextResponse.json({ error: "The active agency does not match this request." }, { status: 403 });
  }

  const loaded = await access.context.admin.from("department_rules")
    .select("range_qualification_rules")
    .eq("department_id", departmentId)
    .maybeSingle();
  if (loaded.error) return NextResponse.json({ error: "The current view configuration could not be loaded." }, { status: 500 });

  const normalized = normalizeAnalyticsDashboardConfiguration(body.configuration);
  const saved = await access.context.admin.from("department_rules").upsert({
    department_id: departmentId,
    range_qualification_rules: mergeAnalyticsDashboardConfiguration(
      loaded.data?.range_qualification_rules,
      normalized,
    ),
  }, { onConflict: "department_id" });
  if (saved.error) return NextResponse.json({ error: "The view configuration could not be saved." }, { status: 500 });
  return NextResponse.json({ ok: true, configuration: normalized });
}
