import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

type RouteContext = { params: Promise<{ eventId: string }> };

const MANAGE_PERMISSIONS = [
  "manage_certifications",
  "manage_training",
  "manage_range_days",
] as const;

const ATTENDANCE_STATUSES = new Set([
  "assigned",
  "present",
  "excused",
  "no_show",
]);

const OUTCOME_STATUSES = new Set([
  "pending",
  "completed",
  "passed",
  "failed",
  "incomplete",
  "remedial_required",
]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function findEvent(admin: any, departmentId: string, eventId: string) {
  return admin
    .from("agency_training_events")
    .select("id,title,default_hours,status")
    .eq("department_id", departmentId)
    .eq("id", eventId)
    .maybeSingle();
}

async function loadRoster(admin: any, departmentId: string, eventId: string) {
  const [attendeesResult, membershipsResult] = await Promise.all([
    admin
      .from("agency_training_attendees")
      .select(
        "id,user_id,attendance_status,outcome_status,hours_completed,score_text,result_notes,remedial_notes,recorded_at,updated_at",
      )
      .eq("department_id", departmentId)
      .eq("event_id", eventId)
      .order("created_at", { ascending: true }),
    admin
      .from("department_memberships")
      .select("user_id,badge_number,rank_title,unit_name,is_active")
      .eq("department_id", departmentId)
      .eq("is_active", true),
  ]);

  if (attendeesResult.error) {
    return { error: attendeesResult.error.message } as const;
  }
  if (membershipsResult.error) {
    return { error: membershipsResult.error.message } as const;
  }

  const memberships = membershipsResult.data ?? [];
  const userIds = memberships.map((row: any) => String(row.user_id));
  let profiles: any[] = [];

  if (userIds.length > 0) {
    const profileResult = await admin
      .from("profiles")
      .select("id,full_name")
      .in("id", userIds);

    if (profileResult.error) {
      return { error: profileResult.error.message } as const;
    }
    profiles = profileResult.data ?? [];
  }

  const profileMap = new Map(
    profiles.map((profile: any) => [String(profile.id), profile]),
  );

  const members = memberships
    .map((membership: any) => {
      const profile = profileMap.get(String(membership.user_id));
      return {
        userId: String(membership.user_id),
        fullName:
          text(profile?.full_name) ||
          text(membership.rank_title) ||
          "Unnamed Member",
        badgeNumber: text(membership.badge_number) || null,
        rankTitle: text(membership.rank_title) || null,
        unitName: text(membership.unit_name) || null,
      };
    })
    .sort((left: any, right: any) =>
      left.fullName.localeCompare(right.fullName),
    );

  const memberMap = new Map<string, any>(
    members.map((member: any) => [member.userId, member]),
  );

  const attendees = (attendeesResult.data ?? []).map((row: any) => ({
    id: row.id,
    userId: String(row.user_id),
    fullName: memberMap.get(String(row.user_id))?.fullName ?? "Former Member",
    badgeNumber: memberMap.get(String(row.user_id))?.badgeNumber ?? null,
    rankTitle: memberMap.get(String(row.user_id))?.rankTitle ?? null,
    unitName: memberMap.get(String(row.user_id))?.unitName ?? null,
    attendanceStatus: row.attendance_status,
    outcomeStatus: row.outcome_status,
    hoursCompleted: row.hours_completed,
    scoreText: row.score_text,
    resultNotes: row.result_notes,
    remedialNotes: row.remedial_notes,
    recordedAt: row.recorded_at,
    updatedAt: row.updated_at,
  }));

  return { members, attendees, error: null } as const;
}

export async function GET(_request: NextRequest, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const context = resolved.context;
  const { eventId } = await routeContext.params;
  const eventResult = await findEvent(
    context.admin,
    context.departmentId,
    eventId,
  );

  if (eventResult.error) {
    return NextResponse.json({ error: eventResult.error.message }, { status: 500 });
  }
  if (!eventResult.data) {
    return NextResponse.json({ error: "Training event not found." }, { status: 404 });
  }

  const roster = await loadRoster(context.admin, context.departmentId, eventId);
  if (roster.error) {
    return NextResponse.json({ error: roster.error }, { status: 500 });
  }

  return NextResponse.json(
    {
      event: {
        id: eventResult.data.id,
        title: eventResult.data.title,
        defaultHours: eventResult.data.default_hours,
        status: eventResult.data.status,
      },
      members: roster.members,
      attendees: roster.attendees,
      canManage: hasAnyServerPermission(context, MANAGE_PERMISSIONS),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: NextRequest, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const context = resolved.context;
  if (!hasAnyServerPermission(context, MANAGE_PERMISSIONS)) {
    return permissionDeniedResponse(
      "Training-management permission is required to update this roster.",
    );
  }

  const { eventId } = await routeContext.params;
  const eventResult = await findEvent(
    context.admin,
    context.departmentId,
    eventId,
  );

  if (eventResult.error) {
    return NextResponse.json({ error: eventResult.error.message }, { status: 500 });
  }
  if (!eventResult.data) {
    return NextResponse.json({ error: "Training event not found." }, { status: 404 });
  }
  if (["completed", "cancelled"].includes(String(eventResult.data.status))) {
    return NextResponse.json(
      { error: "Reopen this event before changing its roster or results." },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    attendees?: unknown;
  };
  if (!Array.isArray(body.attendees)) {
    return NextResponse.json(
      { error: "A training roster is required." },
      { status: 400 },
    );
  }

  const submitted = body.attendees as Array<Record<string, unknown>>;
  const userIds = Array.from(
    new Set(submitted.map((row) => text(row.userId)).filter(Boolean)),
  );

  if (userIds.length !== submitted.length) {
    return NextResponse.json(
      { error: "Each roster member must appear exactly once." },
      { status: 400 },
    );
  }

  if (userIds.length > 0) {
    const membersResult = await context.admin
      .from("department_memberships")
      .select("user_id")
      .eq("department_id", context.departmentId)
      .eq("is_active", true)
      .in("user_id", userIds);

    if (membersResult.error) {
      return NextResponse.json(
        { error: membersResult.error.message },
        { status: 500 },
      );
    }

    if ((membersResult.data ?? []).length !== userIds.length) {
      return NextResponse.json(
        { error: "One or more selected personnel are not active department members." },
        { status: 400 },
      );
    }
  }

  const rows = submitted.map((row) => {
    const attendanceStatus = text(row.attendanceStatus) || "assigned";
    const outcomeStatus = text(row.outcomeStatus) || "pending";

    if (!ATTENDANCE_STATUSES.has(attendanceStatus)) {
      throw new Error("A roster entry contains an invalid attendance status.");
    }
    if (!OUTCOME_STATUSES.has(outcomeStatus)) {
      throw new Error("A roster entry contains an invalid outcome status.");
    }

    return {
      department_id: context.departmentId,
      event_id: eventId,
      user_id: text(row.userId),
      attendance_status: attendanceStatus,
      outcome_status: outcomeStatus,
      hours_completed: numberOrNull(row.hoursCompleted),
      score_text: text(row.scoreText) || null,
      result_notes: text(row.resultNotes) || null,
      remedial_notes: text(row.remedialNotes) || null,
      recorded_by_user_id: context.userId,
      recorded_at: new Date().toISOString(),
      created_by_user_id: context.userId,
      updated_by_user_id: context.userId,
      updated_at: new Date().toISOString(),
    };
  });

  const existingResult = await context.admin
    .from("agency_training_attendees")
    .select("id,user_id")
    .eq("department_id", context.departmentId)
    .eq("event_id", eventId);

  if (existingResult.error) {
    return NextResponse.json(
      { error: existingResult.error.message },
      { status: 500 },
    );
  }

  const removedIds = (existingResult.data ?? [])
    .filter((row: any) => !userIds.includes(String(row.user_id)))
    .map((row: any) => String(row.id));

  if (removedIds.length > 0) {
    const removed = await context.admin
      .from("agency_training_attendees")
      .delete()
      .eq("department_id", context.departmentId)
      .eq("event_id", eventId)
      .in("id", removedIds);

    if (removed.error) {
      return NextResponse.json({ error: removed.error.message }, { status: 500 });
    }
  }

  if (rows.length > 0) {
    const upserted = await context.admin
      .from("agency_training_attendees")
      .upsert(rows, { onConflict: "event_id,user_id" });

    if (upserted.error) {
      return NextResponse.json({ error: upserted.error.message }, { status: 500 });
    }
  }

  await context.admin
    .from("agency_training_events")
    .update({
      updated_by_user_id: context.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("department_id", context.departmentId)
    .eq("id", eventId);

  const roster = await loadRoster(context.admin, context.departmentId, eventId);
  if (roster.error) {
    return NextResponse.json({ error: roster.error }, { status: 500 });
  }

  return NextResponse.json({ attendees: roster.attendees });
}