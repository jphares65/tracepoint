import { NextRequest, NextResponse } from "next/server";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

type RouteContext = { params: Promise<{ firearmId: string }> };
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_: NextRequest, { params }: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  const { firearmId } = await params;
  if (!uuid.test(firearmId)) return NextResponse.json({ error: "Invalid firearm." }, { status: 400 });
  const { data: assignment, error: assignmentError } = await context.db.from("firearm_assignments").select("assigned_to_user_id").eq("department_id", context.departmentId).eq("firearm_id", firearmId).is("returned_at", null).maybeSingle();
  if (assignmentError) return NextResponse.json({ error: assignmentError.message }, { status: 500 });
  const canOperateOwn = assignment?.assigned_to_user_id === context.userId;
  const canReadHistory = hasAnyServerPermission(context, ["firearm_custody.view_history", "manage_firearms", "manage_firearm_restrictions", "manage_restricted_firearm_custody"]);
  if (!canOperateOwn && !canReadHistory) return permissionDeniedResponse("Custody access is required.");
  const [current, events, restrictions] = await Promise.all([
    context.db.from("firearm_current_custody").select("*").eq("department_id", context.departmentId).eq("firearm_id", firearmId).maybeSingle(),
    canReadHistory ? context.db.from("firearm_custody_events").select("*").eq("department_id", context.departmentId).eq("firearm_id", firearmId).order("occurred_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    context.db.from("firearm_possession_restrictions").select("*").eq("department_id", context.departmentId).eq("firearm_id", firearmId).order("effective_start", { ascending: false }),
  ]);
  const error = current.error || events.error || restrictions.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ current: current.data, events: events.data ?? [], restrictions: restrictions.data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  const { firearmId } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = text(body.action);
  if (!uuid.test(firearmId) || !["CHECK_OUT", "CHECK_IN"].includes(action ?? "") || !uuid.test(text(body.idempotencyKey) ?? "")) return NextResponse.json({ error: "A valid firearm, restricted custody action, and idempotency key are required." }, { status: 400 });
  const result = await context.db.rpc("operate_restricted_firearm_custody", { p_firearm_id: firearmId, p_action: action, p_storage_location_id: text(body.storageLocationId), p_notes: text(body.notes), p_idempotency_key: text(body.idempotencyKey) });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: result.error.code === "42501" ? 403 : 409 });
  return NextResponse.json({ ok: true, custodyEventId: result.data });
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  const { firearmId } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (!uuid.test(firearmId) || !hasAnyServerPermission(context, ["manage_firearm_restrictions"])) return permissionDeniedResponse("Restriction-management permission is required.");
  const restrictionType = text(body.restrictionType);
  if (!restrictionType || !["no_carry", "duty_only"].includes(restrictionType)) return NextResponse.json({ error: "Restriction type must be no_carry or duty_only." }, { status: 400 });
  const result = await context.db.rpc("set_firearm_restriction", {
    p_firearm_id: firearmId, p_restriction_type: restrictionType,
    p_effective_date: text(body.effectiveDate), p_reason: text(body.reason),
    p_notes: text(body.notes), p_review_date: text(body.reviewDate),
  });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: result.error.code === "42501" ? 403 : 409 });
  return NextResponse.json({ ok: true, restrictionId: result.data });
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  const { firearmId } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const restrictionId = text(body.restrictionId);
  if (!uuid.test(firearmId) || !uuid.test(restrictionId ?? "") || !hasAnyServerPermission(context, ["manage_firearm_restrictions"])) return permissionDeniedResponse("Restriction-management permission is required.");
  const result = await context.db.rpc("clear_firearm_restriction", { p_restriction_id: restrictionId, p_reason: text(body.reason) });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: result.error.code === "42501" ? 403 : 409 });
  return NextResponse.json({ ok: true, restrictionId: result.data });
}
