import { NextRequest, NextResponse } from "next/server";

import { createRangeReadRepository } from "@/lib/range/read-repository";
import { applyMobileRangeMutation, mobileRangeDaySummary, type MobileRangeAction } from "@/lib/range/mobile-range-workspace";
import { authorizeRangeWorkspaceMutation } from "@/lib/range/workspace-mutation";
import { accessFailureResponse, hasAnyServerPermission, hasServerFeature, resolveServerAccess } from "@/lib/tracepoint/server-access";

type Context = { params: Promise<{ rangeDayId: string }> };
const safeId = /^[A-Za-z0-9_-]{1,128}$/;
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const number = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;

function parseAction(body: Record<string, unknown>, userId: string): MobileRangeAction | null {
  const type = text(body.type, 32);
  const operationId = text(body.operationId, 128);
  if (!safeId.test(operationId)) return null;
  if (type === "attendance") {
    const rosterEntryId = text(body.rosterEntryId, 128);
    return safeId.test(rosterEntryId) && typeof body.attended === "boolean" ? { type, operationId, rosterEntryId, attended: body.attended } : null;
  }
  if (type === "bulk-attendance") return typeof body.attended === "boolean" ? { type, operationId, attended: body.attended } : null;
  if (type === "remove-roster") {
    const rosterEntryId = text(body.rosterEntryId, 128);
    return safeId.test(rosterEntryId) ? { type, operationId, rosterEntryId } : null;
  }
  if (type === "remove-drill") {
    const drillId = text(body.drillId, 128);
    return safeId.test(drillId) ? { type, operationId, drillId } : null;
  }
  if (type === "reorder-drills") {
    const drillIds = Array.isArray(body.drillIds) ? body.drillIds.map((value) => text(value, 128)) : [];
    return drillIds.length <= 100 && drillIds.every((value) => safeId.test(value)) ? { type, operationId, drillIds } : null;
  }
  const input = body.value && typeof body.value === "object" ? body.value as Record<string, unknown> : {};
  if (type === "add-roster") {
    const id = text(input.id, 128), officerId = text(input.officerId ?? input.officer_id, 128);
    const assignedFirearmIds = Array.isArray(input.assignedFirearmIds) ? input.assignedFirearmIds.map((value) => text(value, 128)).filter((value) => safeId.test(value)).slice(0, 10) : [];
    return safeId.test(id) && safeId.test(officerId) ? { type, operationId, entry: { id, officerId, assignedFirearmIds, attended: input.attended === true } } : null;
  }
  if (type === "add-drill") {
    const id = text(input.id, 128), sourceTemplateId = text(input.sourceTemplateId, 128);
    return safeId.test(id) && safeId.test(sourceTemplateId) ? { type, operationId, drill: { id, sourceTemplateId } } : null;
  }
  if (type === "save-score") {
    const id = text(input.id, 128), drillId = text(input.drillId ?? input.drill_id, 128), officerId = text(input.officerId ?? input.officer_id, 128);
    if (!safeId.test(id) || !safeId.test(drillId) || !safeId.test(officerId)) return null;
    return { type, operationId, result: {
      id, drillId, officerId, firearmId: text(input.firearmId, 128) || undefined, runNumber: Math.trunc(number(input.runNumber, 1, 20) ?? 1),
      completed: input.completed === true, score: number(input.score, 0, 10000), timeSeconds: number(input.timeSeconds, 0, 100000),
      hitCount: number(input.hitCount, 0, 10000), passed: typeof input.passed === "boolean" ? input.passed : undefined,
      finalPassed: typeof input.finalPassed === "boolean" ? input.finalPassed : undefined, instructorId: userId, notes: text(input.notes, 2000) || undefined,
    } };
  }
  return null;
}

export async function GET(_request: NextRequest, routeContext: Context) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasServerFeature(access.context, "range_training") && !hasServerFeature(access.context, "qualifications")) {
    return NextResponse.json({ error: "Range & Training is not enabled." }, { status: 403 });
  }
  const { rangeDayId } = await routeContext.params;
  const repository = createRangeReadRepository(access.context.admin, access.context.departmentId);
  const [range, people] = await Promise.all([repository.getWorkspace(access.context.departmentId), repository.getPersonnel(access.context.departmentId)]);
  const summary = mobileRangeDaySummary(range.workspace, rangeDayId);
  if (!summary.rangeDay) return NextResponse.json({ error: "Range day was not found." }, { status: 404 });
  const profiles = new Map(people.profiles.map((profile) => [String(profile.id), profile]));
  const personnel = people.memberships.map((membership) => ({ ...membership, profile: profiles.get(String(membership.user_id)) ?? null }));
  return NextResponse.json({
    ...summary,
    drillLibrary: Array.isArray((range.workspace as Record<string, unknown> | null)?.drillLibrary) ? (range.workspace as Record<string, unknown>).drillLibrary : [],
    userId: access.context.userId,
    personnel,
    updatedAt: range.updatedAt,
    permissions: {
      canManage: hasAnyServerPermission(access.context, ["manage_range_days"]),
      canScore: hasAnyServerPermission(access.context, ["score_range_days", "manage_qualifications", "manage_range_days"]),
    },
  }, { headers: { "Cache-Control": "no-store, private" } });
}

export async function POST(request: NextRequest, routeContext: Context) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasServerFeature(access.context, "range_training")) return NextResponse.json({ error: "Range & Training is not enabled." }, { status: 403 });
  const { rangeDayId } = await routeContext.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = parseAction(body, access.context.userId);
  if (!action) return NextResponse.json({ error: "The Range Day action is invalid." }, { status: 400 });
  const current = await access.context.admin.from("pilot_range_workspaces").select("workspace,updated_at,updated_by_user_id")
    .eq("department_id", access.context.departmentId).maybeSingle();
  if (current.error) return NextResponse.json({ error: "The Range Day workspace could not be loaded." }, { status: 500 });
  if (!current.data) return NextResponse.json({ error: "The Range Day workspace was not found." }, { status: 404 });
  if (action.type === "add-roster") {
    const officerId = String(action.entry.officerId ?? "");
    const membership = await access.context.admin.from("department_memberships").select("user_id")
      .eq("department_id", access.context.departmentId).eq("user_id", officerId).eq("is_active", true).maybeSingle();
    if (membership.error) return NextResponse.json({ error: "Roster authorization failed." }, { status: 500 });
    if (!membership.data) return NextResponse.json({ error: "Only active agency members can be rostered." }, { status: 403 });
  }
  const mutation = applyMobileRangeMutation({ workspace: current.data.workspace, rangeDayId, permissions: access.context.permissions, action });
  if (!mutation.ok) return NextResponse.json({ error: mutation.error }, { status: mutation.status });
  if (mutation.alreadyApplied) return NextResponse.json({ ok: true, alreadyApplied: true, ...mobileRangeDaySummary(mutation.workspace, rangeDayId) });
  const decision = authorizeRangeWorkspaceMutation({ existingWorkspace: current.data.workspace, nextWorkspace: mutation.workspace, departmentId: access.context.departmentId, permissions: access.context.permissions });
  if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });
  const updatedAt = new Date(Math.max(Date.now(), Date.parse(String(current.data.updated_at)) + 1)).toISOString();
  const updated = await access.context.admin.from("pilot_range_workspaces").update({ workspace: mutation.workspace, updated_at: updatedAt, updated_by_user_id: access.context.userId })
    .eq("department_id", access.context.departmentId).eq("updated_at", current.data.updated_at).select("department_id").maybeSingle();
  if (updated.error) return NextResponse.json({ error: "The Range Day action could not be saved." }, { status: 500 });
  if (!updated.data) return NextResponse.json({ error: "The Range Day changed. Retry this action." }, { status: 409 });
  const audit = await access.context.admin.from("audit_events").insert({ department_id: access.context.departmentId, actor_user_id: access.context.userId, action: "update", entity_type: "range_day", entity_id: null, summary: `Mobile Range Day action: ${action.type}.`, new_value: { range_day_id: rangeDayId, operation_id: action.operationId, action: action.type } });
  if (audit.error) {
    await access.context.admin.from("pilot_range_workspaces").update({ workspace: current.data.workspace, updated_at: current.data.updated_at, updated_by_user_id: current.data.updated_by_user_id })
      .eq("department_id", access.context.departmentId).eq("updated_at", updatedAt);
    return NextResponse.json({ error: "The Range Day audit failed; the action was reversed." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, alreadyApplied: false, ...mobileRangeDaySummary(mutation.workspace, rangeDayId) });
}
