import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const context = resolved.context;
  const memberships = await context.admin
    .from("department_memberships")
    .select("user_id,badge_number,rank_title,unit_name")
    .eq("department_id", context.departmentId)
    .eq("is_active", true);

  if (memberships.error) {
    return NextResponse.json({ error: memberships.error.message }, { status: 500 });
  }

  const rows = memberships.data ?? [];
  const userIds = rows.map((row: any) => String(row.user_id));
  let profiles: any[] = [];

  if (userIds.length > 0) {
    const profileResult = await context.admin
      .from("profiles")
      .select("id,full_name")
      .in("id", userIds);

    if (profileResult.error) {
      return NextResponse.json({ error: profileResult.error.message }, { status: 500 });
    }
    profiles = profileResult.data ?? [];
  }

  const profileMap = new Map<string, any>(
    profiles.map((profile: any) => [String(profile.id), profile]),
  );

  const instructors = rows
    .map((membership: any) => ({
      userId: String(membership.user_id),
      fullName:
        text(profileMap.get(String(membership.user_id))?.full_name) ||
        text(membership.rank_title) ||
        "Unnamed Member",
      badgeNumber: text(membership.badge_number) || null,
      rankTitle: text(membership.rank_title) || null,
      unitName: text(membership.unit_name) || null,
    }))
    .sort((left: any, right: any) => left.fullName.localeCompare(right.fullName));

  return NextResponse.json(
    { instructors },
    { headers: { "Cache-Control": "no-store" } },
  );
}