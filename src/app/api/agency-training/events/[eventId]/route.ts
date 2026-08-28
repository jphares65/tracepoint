import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

type RouteContext = { params: Promise<{ eventId: string }> };

const MANAGE_PERMISSIONS = [
  "manage_training",
  "manage_certifications",
  "manage_range_days",
] as const;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dateTimeOrNull(value: unknown) {
  const valueText = text(value);
  if (!valueText) return null;
  const parsed = new Date(valueText);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const context = resolved.context;
  if (!hasAnyServerPermission(context, MANAGE_PERMISSIONS)) {
    return permissionDeniedResponse(
      "Training-management permission is required to edit an event.",
    );
  }

  const { eventId } = await routeContext.params;
  const existing = await context.admin
    .from("agency_training_events")
    .select("*")
    .eq("department_id", context.departmentId)
    .eq("id", eventId)
    .maybeSingle();

  if (existing.error) {
    return NextResponse.json({ error: existing.error.message }, { status: 500 });
  }
  if (!existing.data) {
    return NextResponse.json({ error: "Training event not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reopen = body.reopen === true;
  const reopenReason = text(body.reopenReason);

  if (existing.data.status === "completed" && !reopen) {
    return NextResponse.json(
      { error: "Completed events must be reopened before they can be edited." },
      { status: 409 },
    );
  }
  if (reopen && !reopenReason) {
    return NextResponse.json(
      { error: "A reason is required to reopen completed training." },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {
    updated_by_user_id: context.userId,
    updated_at: new Date().toISOString(),
  };

  if (reopen) {
    const reopened = await context.admin.rpc("reopen_agency_training_event", {
      p_department_id: context.departmentId,
      p_event_id: eventId,
      p_actor_user_id: context.userId,
      p_reason: reopenReason,
    });
    if (reopened.error) {
      return NextResponse.json({ error: reopened.error.message }, { status: 400 });
    }
    const refreshed = await context.admin
      .from("agency_training_events")
      .select("*")
      .eq("department_id", context.departmentId)
      .eq("id", eventId)
      .single();
    if (refreshed.error) {
      return NextResponse.json({ error: refreshed.error.message }, { status: 500 });
    }
    return NextResponse.json({ event: refreshed.data });
  } else {
    if ("title" in body) patch.title = text(body.title);
    if ("trainingType" in body) patch.training_type = text(body.trainingType);
    if ("category" in body) patch.category = text(body.category) || null;
    if ("description" in body) patch.description = text(body.description) || null;
    if ("topics" in body) {
      patch.topics = Array.isArray(body.topics)
        ? Array.from(new Set(body.topics.map(text).filter(Boolean))).slice(0, 50)
        : [];
    }
    if ("location" in body) patch.location = text(body.location) || null;
    if ("startsAt" in body) patch.starts_at = dateTimeOrNull(body.startsAt);
    if ("endsAt" in body) patch.ends_at = dateTimeOrNull(body.endsAt);
    if ("defaultHours" in body) patch.default_hours = numberOrNull(body.defaultHours);
    if ("status" in body) {
      const status = text(body.status);
      if (["draft", "scheduled", "in_progress", "cancelled"].includes(status)) {
        patch.status = status;
      }
    }
    if ("courseId" in body) patch.course_id = text(body.courseId) || null;
    if ("lessonPlanRequired" in body) {
      patch.lesson_plan_required = body.lessonPlanRequired === true;
    }
    if ("certificateEnabled" in body) {
      patch.certificate_enabled = body.certificateEnabled === true;
    }
    if ("certificateTitle" in body) {
      patch.certificate_title = text(body.certificateTitle) || null;
    }
  }

  const updated = await context.admin
    .from("agency_training_events")
    .update(patch)
    .eq("department_id", context.departmentId)
    .eq("id", eventId)
    .select("*")
    .single();

  if (updated.error) {
    return NextResponse.json({ error: updated.error.message }, { status: 400 });
  }

  if (!reopen && ("instructorUserId" in body || "outsideInstructorName" in body)) {
    const instructorUserId = text(body.instructorUserId);
    const outsideName = text(body.outsideInstructorName);
    let displayName = outsideName;
    let organization = text(body.outsideInstructorOrganization) || null;

    if (instructorUserId) {
      const membership = await context.admin
        .from("department_memberships")
        .select("user_id,rank_title")
        .eq("department_id", context.departmentId)
        .eq("user_id", instructorUserId)
        .eq("is_active", true)
        .maybeSingle();
      if (membership.error) {
        return NextResponse.json({ error: membership.error.message }, { status: 500 });
      }
      if (!membership.data) {
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
        return NextResponse.json({ error: profile.error.message }, { status: 500 });
      }
      displayName =
        text(profile.data?.full_name) ||
        text(membership.data.rank_title) ||
        "Agency Instructor";
      organization = context.departmentName;
    }

    if (!displayName) {
      return NextResponse.json(
        { error: "Select an internal instructor or enter an external instructor." },
        { status: 400 },
      );
    }

    const leadResult = await context.admin
      .from("agency_training_event_instructors")
      .select("id")
      .eq("department_id", context.departmentId)
      .eq("event_id", eventId)
      .eq("is_lead", true)
      .maybeSingle();

    if (leadResult.error) {
      return NextResponse.json({ error: leadResult.error.message }, { status: 500 });
    }

    const instructorPayload = {
      user_id: instructorUserId || null,
      display_name: displayName,
      organization,
      credentials: instructorUserId
        ? null
        : text(body.outsideInstructorCredentials) || null,
      instructor_role: text(body.outsideInstructorRole) || "Lead Instructor",
      is_lead: true,
    };

    if (leadResult.data) {
      const instructorUpdate = await context.admin
        .from("agency_training_event_instructors")
        .update(instructorPayload)
        .eq("department_id", context.departmentId)
        .eq("id", leadResult.data.id);
      if (instructorUpdate.error) {
        return NextResponse.json({ error: instructorUpdate.error.message }, { status: 500 });
      }
    } else {
      const instructorInsert = await context.admin
        .from("agency_training_event_instructors")
        .insert({
          department_id: context.departmentId,
          event_id: eventId,
          ...instructorPayload,
          created_by_user_id: context.userId,
        });
      if (instructorInsert.error) {
        return NextResponse.json({ error: instructorInsert.error.message }, { status: 500 });
      }
    }
  }

  if (!reopen && "additionalInstructors" in body) {
    const additional = Array.isArray(body.additionalInstructors)
      ? (body.additionalInstructors as Array<Record<string, unknown>>)
      : [];
    const replacementRows: Array<Record<string, unknown>> = [];

    for (const instructor of additional) {
      const userId = text(instructor.userId);
      let displayName = text(instructor.displayName);
      let organization = text(instructor.organization) || null;

      if (userId) {
        const membership = await context.admin
          .from("department_memberships")
          .select("user_id,rank_title")
          .eq("department_id", context.departmentId)
          .eq("user_id", userId)
          .eq("is_active", true)
          .maybeSingle();
        if (membership.error) {
          return NextResponse.json({ error: membership.error.message }, { status: 500 });
        }
        if (!membership.data) {
          return NextResponse.json(
            { error: "An additional instructor is not an active agency member." },
            { status: 400 },
          );
        }
        const profile = await context.admin
          .from("profiles")
          .select("full_name")
          .eq("id", userId)
          .maybeSingle();
        if (profile.error) {
          return NextResponse.json({ error: profile.error.message }, { status: 500 });
        }
        displayName =
          text(profile.data?.full_name) ||
          text(membership.data.rank_title) ||
          "Agency Instructor";
        organization = context.departmentName;
      }

      if (!displayName) {
        return NextResponse.json(
          { error: "Every additional instructor requires a person or name." },
          { status: 400 },
        );
      }

      replacementRows.push({
        department_id: context.departmentId,
        event_id: eventId,
        user_id: userId || null,
        display_name: displayName,
        organization,
        credentials: userId ? null : text(instructor.credentials) || null,
        instructor_role: text(instructor.instructorRole) || "Instructor",
        is_lead: false,
        created_by_user_id: context.userId,
      });
    }

    const removed = await context.admin
      .from("agency_training_event_instructors")
      .delete()
      .eq("department_id", context.departmentId)
      .eq("event_id", eventId)
      .eq("is_lead", false);
    if (removed.error) {
      return NextResponse.json({ error: removed.error.message }, { status: 500 });
    }

    if (replacementRows.length > 0) {
      const insertedInstructors = await context.admin
        .from("agency_training_event_instructors")
        .insert(replacementRows);
      if (insertedInstructors.error) {
        return NextResponse.json(
          { error: insertedInstructors.error.message },
          { status: 500 },
        );
      }
    }
  }

  return NextResponse.json({ event: updated.data });
}