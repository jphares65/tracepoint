import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { createAgencyTrainingReadRepository } from "@/lib/agency-training/read-repository";
import { ownRows } from "@/lib/tracepoint/training-record-visibility";

type RouteContext = { params: Promise<{ eventId: string }> };

const MANAGE_PERMISSIONS = [
  "manage_training",
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

// Outcomes that certify attendance.
const ATTENDED_OUTCOMES = new Set(["completed", "passed"]);

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
  try {
  const roster = await createAgencyTrainingReadRepository(context.admin, context.departmentId).getRoster({ departmentId: context.departmentId, eventId });
  if (!roster) {
    return NextResponse.json({ error: "Training event not found." }, { status: 404 });
  }

  // Scores, outcomes and remedial notes of other attendees need manage_training.
  const canManage = hasAnyServerPermission(context, MANAGE_PERMISSIONS);
  return NextResponse.json(
    {
      event: {
        id: roster.event.id,
        title: roster.event.title,
        defaultHours: roster.event.default_hours,
        status: roster.event.status,
      },
      members: roster.members,
      attendees: canManage ? roster.attendees : ownRows(roster.attendees, context.userId, ["userId"]),
      canManage,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Training roster could not be loaded." }, { status: 500 }); }
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

  const entries: Array<{ userId: string; fields: Record<string, unknown> }> = [];
  for (const row of submitted) {
    const attendanceStatus = text(row.attendanceStatus) || "assigned";
    const outcomeStatus = text(row.outcomeStatus) || "pending";

    if (!ATTENDANCE_STATUSES.has(attendanceStatus)) {
      return NextResponse.json({ error: "A roster entry contains an invalid attendance status." }, { status: 400 });
    }
    if (!OUTCOME_STATUSES.has(outcomeStatus)) {
      return NextResponse.json({ error: "A roster entry contains an invalid outcome status." }, { status: 400 });
    }
    if (ATTENDED_OUTCOMES.has(outcomeStatus) && attendanceStatus !== "present") {
      return NextResponse.json(
        { error: "An attendee can be marked Completed or Passed only when attendance is Present." },
        { status: 400 },
      );
    }

    entries.push({
      userId: text(row.userId),
      fields: {
        attendance_status: attendanceStatus,
        outcome_status: outcomeStatus,
        hours_completed: numberOrNull(row.hoursCompleted),
        score_text: text(row.scoreText) || null,
        result_notes: text(row.resultNotes) || null,
        remedial_notes: text(row.remedialNotes) || null,
      },
    });
  }

  const existingResult = await context.admin
    .from("agency_training_attendees")
    .select("id,user_id,attendance_status,outcome_status,hours_completed,score_text,result_notes,remedial_notes")
    .eq("department_id", context.departmentId)
    .eq("event_id", eventId);

  if (existingResult.error) {
    return NextResponse.json(
      { error: existingResult.error.message },
      { status: 500 },
    );
  }

  const existingRows = (existingResult.data ?? []) as Array<Record<string, unknown>>;
  const existingByUser = new Map(existingRows.map((row) => [String(row.user_id), row]));

  // Attendees already on the roster stay even if since deactivated; only new
  // additions must be active members.
  const addedUserIds = userIds.filter((userId) => !existingByUser.has(userId));
  if (addedUserIds.length > 0) {
    const membersResult = await context.admin
      .from("department_memberships")
      .select("user_id")
      .eq("department_id", context.departmentId)
      .eq("is_active", true)
      .in("user_id", addedUserIds);

    if (membersResult.error) {
      return NextResponse.json(
        { error: membersResult.error.message },
        { status: 500 },
      );
    }

    if ((membersResult.data ?? []).length !== addedUserIds.length) {
      return NextResponse.json(
        { error: "One or more selected personnel are not active department members." },
        { status: 400 },
      );
    }
  }

  const removedRows = existingRows.filter((row) => !userIds.includes(String(row.user_id)));
  if (removedRows.some((row) => row.attendance_status !== "assigned" || row.outcome_status !== "pending")) {
    return NextResponse.json(
      { error: "Attendance or results are recorded for a removed attendee. Their record is kept; set attendance to Assigned and outcome to Pending before removing them." },
      { status: 409 },
    );
  }

  if (removedRows.length > 0) {
    const removed = await context.admin
      .from("agency_training_attendees")
      .delete()
      .eq("department_id", context.departmentId)
      .eq("event_id", eventId)
      .in("id", removedRows.map((row) => String(row.id)));

    if (removed.error) {
      return NextResponse.json({ error: removed.error.message }, { status: 500 });
    }
  }

  // Only rows that changed are written; recorded_by/at move only when
  // attendance or outcome changed, and created_by is set once on insert.
  const now = new Date().toISOString();
  const recorded = { recorded_by_user_id: context.userId, recorded_at: now };
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  for (const entry of entries) {
    const existing = existingByUser.get(entry.userId);
    const fields = entry.fields;
    if (!existing) {
      const recordedNow = fields.attendance_status !== "assigned" || fields.outcome_status !== "pending";
      inserts.push({
        department_id: context.departmentId,
        event_id: eventId,
        user_id: entry.userId,
        ...fields,
        ...(recordedNow ? recorded : {}),
        created_by_user_id: context.userId,
        updated_by_user_id: context.userId,
        updated_at: now,
      });
      continue;
    }
    const statusChanged = existing.attendance_status !== fields.attendance_status || existing.outcome_status !== fields.outcome_status;
    const existingHours = existing.hours_completed === null || existing.hours_completed === undefined ? null : Number(existing.hours_completed);
    const changed = statusChanged || existingHours !== fields.hours_completed ||
      (existing.score_text ?? null) !== fields.score_text ||
      (existing.result_notes ?? null) !== fields.result_notes ||
      (existing.remedial_notes ?? null) !== fields.remedial_notes;
    if (!changed) continue;
    updates.push({
      id: String(existing.id),
      patch: { ...fields, ...(statusChanged ? recorded : {}), updated_by_user_id: context.userId, updated_at: now },
    });
  }

  if (inserts.length > 0) {
    const inserted = await context.admin.from("agency_training_attendees").insert(inserts);
    if (inserted.error) {
      return NextResponse.json({ error: inserted.error.message }, { status: 500 });
    }
  }

  for (const update of updates) {
    const updated = await context.admin
      .from("agency_training_attendees")
      .update(update.patch)
      .eq("department_id", context.departmentId)
      .eq("event_id", eventId)
      .eq("id", update.id);
    if (updated.error) {
      return NextResponse.json({ error: updated.error.message }, { status: 500 });
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
