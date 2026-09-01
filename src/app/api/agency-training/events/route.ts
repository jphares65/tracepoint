import { NextRequest, NextResponse } from "next/server";
import { createAgencyTrainingReadRepository } from "@/lib/agency-training/read-repository";
import { mapAgencyTrainingEvent } from "@/lib/agency-training/read-repository-core";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

const MANAGE_PERMISSIONS = [
  "manage_certifications",
  "manage_training",
  "manage_range_days",
] as const;

const VALID_STATUSES = new Set([
  "draft",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown) {
  const valueText = text(value);
  return valueText || null;
}

function positiveNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveIntegerOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function dateTimeOrNull(value: unknown) {
  const valueText = text(value);
  if (!valueText) return null;
  const parsed = new Date(valueText);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function topics(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => text(item))
        .filter(Boolean),
    ),
  ).slice(0, 50);
}

export async function GET() {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const context = resolved.context;
  try {
    const events = await createAgencyTrainingReadRepository(context.admin, context.departmentId).listEvents({ departmentId: context.departmentId });
    return NextResponse.json({
      events,
      canManage: hasAnyServerPermission(context, MANAGE_PERMISSIONS),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Training events could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const context = resolved.context;
  if (!hasAnyServerPermission(context, MANAGE_PERMISSIONS)) {
    return permissionDeniedResponse(
      "Training-management permission is required to create an event.",
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  const title = text(body.title);
  const startsAt = dateTimeOrNull(body.startsAt);
  const endsAt = dateTimeOrNull(body.endsAt);
  const requestedStatus = text(body.status).toLowerCase() || "draft";

  if (!title) {
    return NextResponse.json(
      { error: "Training-event title is required." },
      { status: 400 },
    );
  }

  if (!startsAt) {
    return NextResponse.json(
      { error: "A valid training start date and time are required." },
      { status: 400 },
    );
  }

  if (endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
    return NextResponse.json(
      { error: "Training cannot end before it starts." },
      { status: 400 },
    );
  }

  if (!VALID_STATUSES.has(requestedStatus)) {
    return NextResponse.json(
      { error: "The selected training-event status is not valid." },
      { status: 400 },
    );
  }

  const certificationTypeId = nullableText(body.certificationTypeId);
  if (certificationTypeId) {
    const certificationType = await context.admin
      .from("certification_types")
      .select("id")
      .eq("department_id", context.departmentId)
      .eq("id", certificationTypeId)
      .eq("is_active", true)
      .maybeSingle();

    if (certificationType.error) {
      return NextResponse.json(
        { error: certificationType.error.message },
        { status: 500 },
      );
    }

    if (!certificationType.data) {
      return NextResponse.json(
        { error: "The selected certification type is not available." },
        { status: 400 },
      );
    }
  }

  const inserted = await context.admin
    .from("agency_training_events")
    .insert({
      department_id: context.departmentId,
      title,
      course_id: nullableText(body.courseId),
      training_type: text(body.trainingType) || "In-Service",
      category: nullableText(body.category),
      description: nullableText(body.description),
      topics: topics(body.topics),
      location: nullableText(body.location),
      starts_at: startsAt,
      ends_at: endsAt,
      default_hours: positiveNumberOrNull(body.defaultHours),
      status: requestedStatus,
      certification_type_id: certificationTypeId,
      certification_valid_days: positiveIntegerOrNull(
        body.certificationValidDays,
      ),
      certificate_enabled: body.certificateEnabled === true,
      certificate_title: nullableText(body.certificateTitle),
      lesson_plan_required: body.lessonPlanRequired === true,
      notes: nullableText(body.notes),
      created_by_user_id: context.userId,
      updated_by_user_id: context.userId,
    })
    .select("*")
    .single();

  if (inserted.error) {
    return NextResponse.json(
      { error: inserted.error.message },
      { status: 500 },
    );
  }

  const instructorUserId = text(body.instructorUserId);
  const outsideInstructorName = text(body.outsideInstructorName);
  let internalInstructor: { userId: string; fullName: string } | null = null;

  if (instructorUserId) {
    const membership = await context.admin
      .from("department_memberships")
      .select("user_id,rank_title")
      .eq("department_id", context.departmentId)
      .eq("user_id", instructorUserId)
      .eq("is_active", true)
      .maybeSingle();

    if (membership.error) {
      await context.admin
        .from("agency_training_events")
        .delete()
        .eq("department_id", context.departmentId)
        .eq("id", inserted.data.id);
      return NextResponse.json({ error: membership.error.message }, { status: 500 });
    }
    if (!membership.data) {
      await context.admin
        .from("agency_training_events")
        .delete()
        .eq("department_id", context.departmentId)
        .eq("id", inserted.data.id);
      return NextResponse.json(
        { error: "The selected instructor is not an active agency member." },
        { status: 400 },
      );
    }

    const profile = await context.admin
      .from("profiles")
      .select("full_name")
      .eq("id", instructorUserId)
      .maybeSingle();

    if (profile.error) {
      await context.admin
        .from("agency_training_events")
        .delete()
        .eq("department_id", context.departmentId)
        .eq("id", inserted.data.id);
      return NextResponse.json({ error: profile.error.message }, { status: 500 });
    }
    internalInstructor = {
      userId: instructorUserId,
      fullName:
        text(profile.data?.full_name) ||
        text(membership.data.rank_title) ||
        "Agency Instructor",
    };
  }

  if (internalInstructor || outsideInstructorName || body.addCurrentUserAsInstructor !== false) {
    const instructor = await context.admin
      .from("agency_training_event_instructors")
      .insert({
        department_id: context.departmentId,
        event_id: inserted.data.id,
        user_id: internalInstructor?.userId ?? (outsideInstructorName ? null : context.userId),
        display_name:
          internalInstructor?.fullName || outsideInstructorName || context.fullName,
        organization:
          internalInstructor
            ? context.departmentName
            : nullableText(body.outsideInstructorOrganization) ||
              (outsideInstructorName ? null : context.departmentName),
        credentials: internalInstructor
          ? null
          : nullableText(body.outsideInstructorCredentials),
        instructor_role: text(body.outsideInstructorRole) || "Lead Instructor",
        is_lead: true,
        created_by_user_id: context.userId,
      });

    if (instructor.error) {
      await context.admin
        .from("agency_training_events")
        .delete()
        .eq("department_id", context.departmentId)
        .eq("id", inserted.data.id);

      return NextResponse.json(
        { error: instructor.error.message },
        { status: 500 },
      );
    }
  }

  const additionalInstructors = Array.isArray(body.additionalInstructors)
    ? (body.additionalInstructors as Array<Record<string, unknown>>)
    : [];

  if (additionalInstructors.length > 0) {
    const additionalRows: Array<Record<string, unknown>> = [];

    for (const additional of additionalInstructors) {
      const userId = text(additional.userId);
      const externalName = text(additional.displayName);
      let displayName = externalName;
      let organization = nullableText(additional.organization);

      if (userId) {
        const membership = await context.admin
          .from("department_memberships")
          .select("user_id,rank_title")
          .eq("department_id", context.departmentId)
          .eq("user_id", userId)
          .eq("is_active", true)
          .maybeSingle();

        if (membership.error || !membership.data) {
          await context.admin
            .from("agency_training_events")
            .delete()
            .eq("department_id", context.departmentId)
            .eq("id", inserted.data.id);
          return NextResponse.json(
            {
              error:
                membership.error?.message ||
                "An additional instructor is not an active agency member.",
            },
            { status: membership.error ? 500 : 400 },
          );
        }

        const profile = await context.admin
          .from("profiles")
          .select("full_name")
          .eq("id", userId)
          .maybeSingle();
        if (profile.error) {
          await context.admin
            .from("agency_training_events")
            .delete()
            .eq("department_id", context.departmentId)
            .eq("id", inserted.data.id);
          return NextResponse.json({ error: profile.error.message }, { status: 500 });
        }
        displayName =
          text(profile.data?.full_name) ||
          text(membership.data.rank_title) ||
          "Agency Instructor";
        organization = context.departmentName;
      }

      if (!displayName) {
        await context.admin
          .from("agency_training_events")
          .delete()
          .eq("department_id", context.departmentId)
          .eq("id", inserted.data.id);
        return NextResponse.json(
          { error: "Every additional instructor requires a person or name." },
          { status: 400 },
        );
      }

      additionalRows.push({
        department_id: context.departmentId,
        event_id: inserted.data.id,
        user_id: userId || null,
        display_name: displayName,
        organization,
        credentials: userId ? null : nullableText(additional.credentials),
        instructor_role: text(additional.instructorRole) || "Instructor",
        is_lead: false,
        created_by_user_id: context.userId,
      });
    }

    const additionalInsert = await context.admin
      .from("agency_training_event_instructors")
      .insert(additionalRows);
    if (additionalInsert.error) {
      await context.admin
        .from("agency_training_events")
        .delete()
        .eq("department_id", context.departmentId)
        .eq("id", inserted.data.id);
      return NextResponse.json({ error: additionalInsert.error.message }, { status: 500 });
    }
  }

  const createdEvent = await context.admin
    .from("agency_training_events")
    .select(
      "*,agency_training_attendees(id,outcome_status),agency_training_event_instructors(id,user_id,display_name,organization,credentials,instructor_role,is_lead)",
    )
    .eq("department_id", context.departmentId)
    .eq("id", inserted.data.id)
    .single();

  return NextResponse.json(
    { event: mapAgencyTrainingEvent(createdEvent.data ?? inserted.data) },
    { status: 201 },
  );
}
