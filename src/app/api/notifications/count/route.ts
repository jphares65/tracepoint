import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export async function GET() {
  const access = await resolveServerAccess();

  if (!access.ok) {
    return accessFailureResponse(access);
  }

  const context = access.context;
  const now = Date.now();

  const { data, error } = await context.admin
    .from("notification_events")
    .select("acknowledged_at,snoozed_until")
    .eq("department_id", context.departmentId)
    .eq("user_id", context.userId)
    .is("resolved_at", null);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  const count = (data ?? []).filter((row: any) => {
    if (row.acknowledged_at) return false;
    if (!row.snoozed_until) return true;

    return new Date(row.snoozed_until).getTime() <= now;
  }).length;

  return NextResponse.json(
    { count },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}