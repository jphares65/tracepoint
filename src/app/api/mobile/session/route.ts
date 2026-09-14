import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { resolveRuntimeCognitoBearerPrincipal } from "@/lib/authentication/cognito-mobile-session";
import { parseUniqueBearerToken } from "@/lib/authentication/request-bearer-core";
import {
  listPostgresMemberships,
  resolvePostgresIdentitySummary,
  resolvePostgresAccess,
} from "@/lib/tracepoint/server-access-postgres";
import { toAccessPayload } from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  const requestHeaders = await headers();
  const token = parseUniqueBearerToken(requestHeaders.get("authorization"));
  if (!token) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }
  const principal = await resolveRuntimeCognitoBearerPrincipal(token);
  if (!principal) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  const [memberships, identity] = await Promise.all([
    listPostgresMemberships(principal),
    resolvePostgresIdentitySummary(principal),
  ]);
  const selected = requestHeaders.get("x-tracepoint-department-id")?.trim() ?? "";
  if (selected && !uuid.test(selected)) {
    return NextResponse.json({ error: "The selected department is invalid." }, { status: 400 });
  }
  const membershipPayload = memberships.map((membership) => ({
    departmentId: String(membership.department_id ?? ""),
    departmentName: String(membership.departments?.name ?? "TracePoint Department"),
    departmentShortName: String(membership.departments?.short_name ?? membership.departments?.name ?? "TracePoint"),
    departmentPatchUrl: String(membership.departments?.patch_url ?? ""),
    badgeNumber: String(membership.badge_number ?? ""),
    rankTitle: String(membership.rank_title ?? ""),
    unitName: String(membership.unit_name ?? ""),
  }));

  if (memberships.length === 0) {
    if (!identity.isPlatformAdmin) return NextResponse.json({ error: "No active department membership was found." }, { status: 403 });
    return NextResponse.json({
      userId: principal.userId,
      displayIdentity: { fullName: identity.fullName, email: identity.email },
      platformAdmin: true,
      selectionRequired: true,
      requiresSupportContext: true,
      memberships: [],
    }, { headers: { "Cache-Control": "no-store, private" } });
  }

  if (!selected && memberships.length > 1) {
    return NextResponse.json({
      userId: principal.userId,
      displayIdentity: { fullName: identity.fullName, email: identity.email },
      platformAdmin: identity.isPlatformAdmin,
      selectionRequired: true,
      memberships: membershipPayload,
    }, { headers: { "Cache-Control": "no-store, private" } });
  }

  const resolved = await resolvePostgresAccess(principal, selected, "");
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  return NextResponse.json({
    selectionRequired: false,
    platformAdmin: identity.isPlatformAdmin,
    memberships: membershipPayload,
    access: toAccessPayload(resolved.context),
  }, { headers: { "Cache-Control": "no-store, private" } });
}
