import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

type RouteContext = { params: Promise<{ courseId: string }> };

const MANAGE_PERMISSIONS = [
  "manage_training",
  "manage_certifications",
  "manage_range_days",
] as const;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const context = resolved.context;
  if (!hasAnyServerPermission(context, MANAGE_PERMISSIONS)) {
    return permissionDeniedResponse(
      "Training-management permission is required to edit a course.",
    );
  }

  const { courseId } = await routeContext.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {
    updated_by_user_id: context.userId,
    updated_at: new Date().toISOString(),
  };

  if ("canonicalTitle" in body) {
    const title = text(body.canonicalTitle);
    if (!title) {
      return NextResponse.json({ error: "Course title cannot be blank." }, { status: 400 });
    }
    patch.canonical_title = title;
  }
  if ("isActive" in body) patch.is_active = body.isActive === true;

  const updated = await context.admin
    .from("agency_training_courses")
    .update(patch)
    .eq("department_id", context.departmentId)
    .eq("id", courseId)
    .select("*")
    .maybeSingle();

  if (updated.error) {
    return NextResponse.json({ error: updated.error.message }, { status: 400 });
  }
  if (!updated.data) {
    return NextResponse.json({ error: "Course not found." }, { status: 404 });
  }

  return NextResponse.json({ course: updated.data });
}