import { NextRequest, NextResponse } from "next/server";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

type RouteContext = { params: Promise<{ firearmId: string }> };
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_: NextRequest, { params }: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  if (!hasAnyServerPermission(context, ["firearm_custody.view_history", "manage_firearms"])) return permissionDeniedResponse("Custody-history permission is required.");
  const { firearmId } = await params;
  if (!uuid.test(firearmId)) return NextResponse.json({ error: "Invalid firearm." }, { status: 400 });
  const [current, events, restrictions] = await Promise.all([
    context.db.from("firearm_current_custody").select("*").eq("department_id", context.departmentId).eq("firearm_id", firearmId).maybeSingle(),
    context.db.from("firearm_custody_events").select("*").eq("department_id", context.departmentId).eq("firearm_id", firearmId).order("occurred_at", { ascending: false }),
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
  const holderType = text(body.toHolderType);
  const correction = body.administrativeCorrection === true;
  const required = correction ? "firearm_custody.override" : holderType === "OFFICER" ? "firearm_custody.check_out" : "firearm_custody.check_in";
  if (!uuid.test(firearmId) || !holderType || !text(body.reason) || !uuid.test(text(body.idempotencyKey) ?? "")) return NextResponse.json({ error: "A valid firearm, destination, reason, and idempotency key are required." }, { status: 400 });
  if (!hasAnyServerPermission(context, [required, "manage_firearms"])) return permissionDeniedResponse("The configured custody permission is required.");
  const result = await context.db.rpc("transfer_firearm_custody", { p_firearm_id: firearmId, p_to_holder_type: holderType, p_to_holder_user_id: text(body.toHolderUserId), p_to_storage_location_id: text(body.toStorageLocationId), p_reason: text(body.reason), p_notes: text(body.notes), p_idempotency_key: text(body.idempotencyKey), p_administrative_correction: correction });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: result.error.code === "42501" ? 403 : 409 });
  return NextResponse.json({ ok: true, custodyEventId: result.data });
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  const { firearmId } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (!uuid.test(firearmId) || !hasAnyServerPermission(context, ["firearm_custody.manage_restrictions", "manage_firearms"])) return permissionDeniedResponse("Restriction-management permission is required.");
  const result = await context.db.rpc("set_firearm_restricted_use", {
    p_firearm_id: firearmId, p_reason: text(body.reasonCategory),
    p_no_possession_permitted: body.noPossessionPermitted === true,
    p_duty_only: body.dutyOnly !== false, p_daily_return_required: body.dailyReturnRequired === true,
    p_supervisor_approval_required: body.supervisorApprovalRequired === true,
    p_notes: text(body.notes),
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
  if (!uuid.test(firearmId) || !uuid.test(restrictionId ?? "") || !hasAnyServerPermission(context, ["firearm_custody.manage_restrictions", "manage_firearms"])) return permissionDeniedResponse("Restriction-management permission is required.");
  const result = await context.db.rpc("clear_firearm_possession_restriction", { p_restriction_id: restrictionId, p_reason: text(body.reason) });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: result.error.code === "42501" ? 403 : 409 });
  return NextResponse.json({ ok: true, restrictionId: result.data });
}
