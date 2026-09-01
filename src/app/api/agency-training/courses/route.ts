import { NextRequest, NextResponse } from "next/server";

import {
  createCourseCatalogRepository,
  mapCourseCatalogRow,
} from "@/lib/agency-training/course-catalog-repository";
import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

const MANAGE_PERMISSIONS = [
  "manage_training",
  "manage_certifications",
  "manage_range_days",
] as const;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveIntegerOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(text).filter(Boolean))).slice(0, 50);
}

const mapCourse = mapCourseCatalogRow;

export async function GET() {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const context = resolved.context;
  try {
    const data = await createCourseCatalogRepository(
      context.admin,
      context.departmentId,
    ).listActiveCourses({ departmentId: context.departmentId });

    return NextResponse.json(
      {
        courses: data.map(mapCourse),
        canManage: hasAnyServerPermission(context, MANAGE_PERMISSIONS),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Training courses could not be loaded.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const context = resolved.context;
  if (!hasAnyServerPermission(context, MANAGE_PERMISSIONS)) {
    return permissionDeniedResponse(
      "Training-management permission is required to create a course.",
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const canonicalTitle = text(body.canonicalTitle);
  if (!canonicalTitle) {
    return NextResponse.json(
      { error: "A canonical course title is required." },
      { status: 400 },
    );
  }

  const inserted = await context.admin
    .from("agency_training_courses")
    .insert({
      department_id: context.departmentId,
      canonical_title: canonicalTitle,
      training_type: text(body.trainingType) || "In-Service",
      category: text(body.category) || null,
      description: text(body.description) || null,
      topics: stringList(body.topics),
      default_location: text(body.defaultLocation) || null,
      default_hours: numberOrNull(body.defaultHours),
      lesson_plan_required: body.lessonPlanRequired === true,
      certification_type_id: text(body.certificationTypeId) || null,
      certification_valid_days: positiveIntegerOrNull(body.certificationValidDays),
      certificate_enabled: body.certificateEnabled === true,
      certificate_title: text(body.certificateTitle) || null,
      created_by_user_id: context.userId,
      updated_by_user_id: context.userId,
    })
    .select("*")
    .single();

  if (inserted.error) {
    const message = inserted.error.code === "23505"
      ? "A course or recognized alias already uses that title."
      : inserted.error.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const aliases = stringList(body.aliases);
  if (aliases.length > 0) {
    const aliasResult = await context.admin
      .from("agency_training_course_aliases")
      .insert(
        aliases.map((aliasTitle) => ({
          department_id: context.departmentId,
          course_id: inserted.data.id,
          alias_title: aliasTitle,
          created_by_user_id: context.userId,
        })),
      );

    if (aliasResult.error) {
      await context.admin
        .from("agency_training_courses")
        .delete()
        .eq("department_id", context.departmentId)
        .eq("id", inserted.data.id);
      return NextResponse.json({ error: aliasResult.error.message }, { status: 400 });
    }
  }

  return NextResponse.json(
    { course: mapCourse({ ...inserted.data, agency_training_course_aliases: aliases.map((alias_title) => ({ alias_title })) }) },
    { status: 201 },
  );
}
