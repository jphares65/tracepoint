import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

const MANAGE_PERMISSIONS = ["manage_training", "manage_certifications"] as const;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveIntegerOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonnegativeInteger(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(text).filter(Boolean))).slice(0, 100);
}

function warningDays(value: unknown) {
  if (!Array.isArray(value)) return [90, 60, 30, 14, 7, 0];
  return Array.from(
    new Set(
      value
        .map(Number)
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 730),
    ),
  ).sort((left, right) => right - left);
}

export async function GET() {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const context = resolved.context;
  const { data, error } = await context.admin
    .from("agency_training_requirements")
    .select("*,agency_training_courses(id,canonical_title)")
    .eq("department_id", context.departmentId)
    .order("requirement_name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    {
      requirements: data ?? [],
      canManage: hasAnyServerPermission(context, MANAGE_PERMISSIONS),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const context = resolved.context;
  if (!hasAnyServerPermission(context, MANAGE_PERMISSIONS)) {
    return permissionDeniedResponse(
      "Training-management permission is required to configure recurring training.",
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const courseId = text(body.courseId);
  const requirementName = text(body.requirementName);
  const scopeType = text(body.scopeType) || "all_members";
  const intervalUnit = text(body.intervalUnit) || null;
  const dueBasis = text(body.dueBasis) || "completion_date";

  if (!courseId || !requirementName) {
    return NextResponse.json(
      { error: "Course and requirement name are required." },
      { status: 400 },
    );
  }

  const inserted = await context.admin
    .from("agency_training_requirements")
    .insert({
      department_id: context.departmentId,
      course_id: courseId,
      requirement_name: requirementName,
      scope_type: scopeType,
      scope_values: stringList(body.scopeValues),
      interval_value: positiveIntegerOrNull(body.intervalValue),
      interval_unit: intervalUnit,
      due_basis: dueBasis,
      fixed_month: positiveIntegerOrNull(body.fixedMonth),
      fixed_day: positiveIntegerOrNull(body.fixedDay),
      warning_days: warningDays(body.warningDays),
      grace_days: nonnegativeInteger(body.graceDays),
      notify_member_inbox: body.notifyMemberInbox !== false,
      notify_member_email: body.notifyMemberEmail !== false,
      notify_training_staff_inbox: body.notifyTrainingStaffInbox !== false,
      notify_training_staff_email: body.notifyTrainingStaffEmail !== false,
      responsible_permission: text(body.responsiblePermission) || "manage_training",
      is_active: body.isActive !== false,
      notes: text(body.notes) || null,
      created_by_user_id: context.userId,
      updated_by_user_id: context.userId,
    })
    .select("*")
    .single();

  if (inserted.error) {
    return NextResponse.json({ error: inserted.error.message }, { status: 400 });
  }

  const selectedMembers = stringList(body.selectedMemberIds);
  if (scopeType === "selected_members" && selectedMembers.length > 0) {
    const assigned = await context.admin
      .from("agency_training_requirement_members")
      .insert(
        selectedMembers.map((userId) => ({
          department_id: context.departmentId,
          requirement_id: inserted.data.id,
          user_id: userId,
          created_by_user_id: context.userId,
        })),
      );

    if (assigned.error) {
      await context.admin
        .from("agency_training_requirements")
        .delete()
        .eq("department_id", context.departmentId)
        .eq("id", inserted.data.id);
      return NextResponse.json({ error: assigned.error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ requirement: inserted.data }, { status: 201 });
}
export async function PATCH(request: NextRequest) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  if (!hasAnyServerPermission(context, MANAGE_PERMISSIONS)) {
    return permissionDeniedResponse("Training-management permission is required to edit recurring training.");
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const requirementId = text(body.requirementId);
  const courseId = text(body.courseId);
  const requirementName = text(body.requirementName);
  const scopeType = text(body.scopeType) || "all_members";
  const intervalUnit = text(body.intervalUnit) || null;
  const dueBasis = text(body.dueBasis) || "completion_date";
  if (!requirementId || !courseId || !requirementName) {
    return NextResponse.json({ error: "Requirement, course, and name are required." }, { status: 400 });
  }

  const existing = await context.admin.from("agency_training_requirements").select("id")
    .eq("department_id", context.departmentId).eq("id", requirementId).maybeSingle();
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });
  if (!existing.data) return NextResponse.json({ error: "Training requirement not found." }, { status: 404 });

  const updated = await context.admin.from("agency_training_requirements").update({
    course_id: courseId,
    requirement_name: requirementName,
    scope_type: scopeType,
    scope_values: stringList(body.scopeValues),
    interval_value: positiveIntegerOrNull(body.intervalValue),
    interval_unit: intervalUnit,
    due_basis: dueBasis,
    fixed_month: positiveIntegerOrNull(body.fixedMonth),
    fixed_day: positiveIntegerOrNull(body.fixedDay),
    warning_days: warningDays(body.warningDays),
    grace_days: nonnegativeInteger(body.graceDays),
    notify_member_inbox: body.notifyMemberInbox !== false,
    notify_member_email: body.notifyMemberEmail !== false,
    notify_training_staff_inbox: body.notifyTrainingStaffInbox !== false,
    notify_training_staff_email: body.notifyTrainingStaffEmail !== false,
    responsible_permission: text(body.responsiblePermission) || "manage_training",
    is_active: body.isActive !== false,
    notes: text(body.notes) || null,
    updated_by_user_id: context.userId,
    updated_at: new Date().toISOString(),
  }).eq("department_id", context.departmentId).eq("id", requirementId).select("*").single();
  if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 400 });

  const removed = await context.admin.from("agency_training_requirement_members").delete()
    .eq("department_id", context.departmentId).eq("requirement_id", requirementId);
  if (removed.error) return NextResponse.json({ error: removed.error.message }, { status: 500 });
  const selectedMembers = stringList(body.selectedMemberIds);
  if (scopeType === "selected_members" && selectedMembers.length > 0) {
    const assigned = await context.admin.from("agency_training_requirement_members").insert(
      selectedMembers.map((userId) => ({ department_id: context.departmentId, requirement_id: requirementId, user_id: userId, created_by_user_id: context.userId })),
    );
    if (assigned.error) return NextResponse.json({ error: assigned.error.message }, { status: 400 });
  }
  return NextResponse.json({ requirement: updated.data });
}

export async function DELETE(request: NextRequest) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  if (!hasAnyServerPermission(context, MANAGE_PERMISSIONS)) {
    return permissionDeniedResponse("Training-management permission is required to remove recurring training.");
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const requirementId = text(body.requirementId);
  if (!requirementId) return NextResponse.json({ error: "Requirement is required." }, { status: 400 });
  const deleted = await context.admin.from("agency_training_requirements").delete()
    .eq("department_id", context.departmentId).eq("id", requirementId).select("id").maybeSingle();
  if (deleted.error) return NextResponse.json({ error: deleted.error.message }, { status: 500 });
  if (!deleted.data) return NextResponse.json({ error: "Training requirement not found." }, { status: 404 });
  return NextResponse.json({ deleted: true });
}