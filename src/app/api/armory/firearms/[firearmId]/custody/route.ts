import { NextRequest, NextResponse } from "next/server";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { parseRestrictedCustodyRequest, restrictedCustodyOperations } from "@/lib/armory/restricted-custody";
import { custodyRecipients, custodyRequestKind, custodyTransferFailure, custodyTransferOperations, custodyTransferPermissions, parseCustodyTransferRequest, restrictedCustodyFailure } from "@/lib/armory/custody-transfer";

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
  // Custody history is readable with view_history or manage_firearms, the rule 028's policy enforces (069); restriction
  // managers see the custody card and restrictions, not the history.
  const canReadHistory = hasAnyServerPermission(context, ["firearm_custody.view_history", "manage_firearms"]);
  const canViewCustody = canReadHistory || hasAnyServerPermission(context, ["manage_firearm_restrictions", "manage_restricted_firearm_custody"]);
  // SV-28: ordinary custody transfer (028) is authorized by these permissions.
  const canTransferIn = hasAnyServerPermission(context, custodyTransferPermissions("SECURE_STORAGE"));
  const canTransferOut = hasAnyServerPermission(context, custodyTransferPermissions("OFFICER"));
  if (!canOperateOwn && !canViewCustody && !canTransferIn && !canTransferOut) return permissionDeniedResponse("Custody access is required.");
  // API-2: for an authorized caller, an unknown firearm or another agency's is not found (as on every sibling firearm
  // route), never 200 with empty custody. The firearms table's own RLS hides firearms from custody-only roles, so the
  // check is 070's agency-scoped existence function.
  const { data: inAgency, error: existenceError } = await context.db.rpc("firearm_in_active_department", { p_firearm_id: firearmId });
  if (existenceError) return NextResponse.json({ error: existenceError.message }, { status: 500 });
  if (inAgency !== true) return NextResponse.json({ error: "Firearm not found." }, { status: 404 });
  const [current, events, restrictions] = await Promise.all([
    context.db.from("firearm_current_custody").select("*").eq("department_id", context.departmentId).eq("firearm_id", firearmId).maybeSingle(),
    canReadHistory ? context.db.from("firearm_custody_events").select("*").eq("department_id", context.departmentId).eq("firearm_id", firearmId).order("occurred_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    context.db.from("firearm_possession_restrictions").select("*").eq("department_id", context.departmentId).eq("firearm_id", firearmId).order("effective_start", { ascending: false }),
  ]);
  const error = current.error || events.error || restrictions.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // UX-RB-4: what this caller may do now, by the same rule the database applies (031).
  const operations = restrictedCustodyOperations({
    assignedToUserId: assignment?.assigned_to_user_id,
    userId: context.userId,
    canManageRestrictedCustody: hasAnyServerPermission(context, ["manage_restricted_firearm_custody"]),
    restrictions: restrictions.data ?? [],
    holderType: current.data?.holder_type,
    holderUserId: current.data?.holder_user_id,
  });
  // SV-28: the ordinary transfer, by 028's rule. SV-31: whether the caller may
  // manage storage locations (034 requires firearm_custody.manage_storage_locations).
  const transfer = custodyTransferOperations({
    canCheckInPermission: canTransferIn,
    canCheckOutPermission: canTransferOut,
    assignedToUserId: assignment?.assigned_to_user_id,
    restrictions: restrictions.data ?? [],
    holderType: current.data?.holder_type,
    holderUserId: current.data?.holder_user_id,
  });
  const canManageStorageLocations = hasAnyServerPermission(context, ["firearm_custody.manage_storage_locations"]);
  // Who may receive temporary custody: active members of this agency only (028's rule).
  let recipients: ReturnType<typeof custodyRecipients> = [];
  if (transfer.canCheckOutTemporary) {
    const members = await context.db.from("department_memberships").select("user_id,is_active,badge_number").eq("department_id", context.departmentId).eq("is_active", true);
    if (members.error) return NextResponse.json({ error: members.error.message }, { status: 500 });
    const ids = (members.data ?? []).map((row: { user_id: string }) => row.user_id);
    const profiles = ids.length ? await context.admin.from("profiles").select("id,full_name").in("id", ids) : { data: [], error: null };
    if (profiles.error) return NextResponse.json({ error: profiles.error.message }, { status: 500 });
    const names = new Map<string, string | null>((profiles.data ?? []).map((row: { id: string; full_name: string | null }) => [row.id, row.full_name]));
    recipients = custodyRecipients(members.data ?? [], names, current.data?.holder_user_id);
  }
  return NextResponse.json({ current: current.data, events: events.data ?? [], restrictions: restrictions.data ?? [], operations: { ...operations, transfer: { ...transfer, recipients }, canManageStorageLocations } }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  const { firearmId } = await params;
  const raw = await request.json().catch(() => null) as unknown;
  const body = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  // SV-28: two operations. `action` is restricted Duty Only custody (031);
  // `toHolderType` is an ordinary transfer (028), never an administrative correction.
  const kind = custodyRequestKind(body);
  if (kind.kind === "invalid") return NextResponse.json({ error: kind.error, code: "invalid_custody_request" }, { status: 400 });
  if (kind.kind === "transfer") {
    const transfer = parseCustodyTransferRequest(firearmId, body);
    if (!transfer.ok) return NextResponse.json({ error: transfer.error, code: transfer.code }, { status: 400 });
    if (!hasAnyServerPermission(context, custodyTransferPermissions(transfer.args.p_to_holder_type))) {
      return permissionDeniedResponse(transfer.args.p_to_holder_type === "OFFICER"
        ? "Checking a firearm out to an officer requires the firearm custody check-out permission."
        : "Checking a firearm in to secure storage requires the firearm custody check-in permission.");
    }
    // Item 3: the recipient must be an active member of this agency (checked
    // here for a clear message; 028 enforces the same rule).
    if (transfer.args.p_to_holder_type === "OFFICER") {
      const recipient = await context.db.from("department_memberships").select("user_id").eq("department_id", context.departmentId).eq("user_id", transfer.args.p_to_holder_user_id).eq("is_active", true).maybeSingle();
      if (recipient.error) return NextResponse.json({ error: recipient.error.message }, { status: 500 });
      if (!recipient.data) return NextResponse.json({ error: "The selected officer is not an active member of this agency.", code: "invalid_officer" }, { status: 400 });
    }
    const result = await context.db.rpc("transfer_firearm_custody", transfer.args);
    if (result.error) {
      const failure = custodyTransferFailure(result.error);
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }
    return NextResponse.json({ ok: true, custodyEventId: result.data });
  }
  const parsed = parseRestrictedCustodyRequest(firearmId, body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const result = await context.db.rpc("operate_restricted_firearm_custody", { p_firearm_id: firearmId, p_action: parsed.action, p_storage_location_id: parsed.storageLocationId, p_notes: parsed.notes, p_idempotency_key: parsed.idempotencyKey });
  if (result.error) { const failure = restrictedCustodyFailure(result.error); return NextResponse.json({ error: failure.error }, { status: failure.status }); }
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
  if (result.error) { const failure = restrictedCustodyFailure(result.error); return NextResponse.json({ error: failure.error }, { status: failure.status }); }
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
  if (result.error) { const failure = restrictedCustodyFailure(result.error); return NextResponse.json({ error: failure.error }, { status: failure.status }); }
  return NextResponse.json({ ok: true, restrictionId: result.data });
}
