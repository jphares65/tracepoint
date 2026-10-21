import { NextResponse } from "next/server";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { canSubmitFleetInspection } from "@/lib/tracepoint/fleet-server";
import { lookupQrRecords, parseQrIdentifier, qrDecision, qrLookupFilter } from "@/lib/tracepoint/mobile-workflows";
export const dynamic = "force-dynamic";
const identifier = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 2048) : "";
export async function POST(request: Request) {
  const resolved = await resolveServerAccess(request); if (!resolved.ok) return accessFailureResponse(resolved);
  const value = identifier((await request.json().catch(() => ({})) as { identifier?: unknown }).identifier);
  const parsed = parseQrIdentifier(value);
  if (!parsed) return NextResponse.json({ status: "unknown", message: "This QR code is not valid." }, { status: 400 });
  const { admin, departmentId, ...context } = resolved.context;
  // Vehicle access follows the inspection-eligibility rule: on AWS-native the database rule (055) is authoritative,
  // because RLS may hide fleet_rules from the caller; in bridge mode the service-role client reads the rules.
  let vehicleInspectionEligible: boolean;
  const awsNative = process.env.TRACEPOINT_DATA_PROVIDER === "postgres";
  if (awsNative) {
    const eligible = await admin.rpc("can_submit_fleet_inspection", { p_department_id: departmentId });
    if (eligible.error) return NextResponse.json({ error: "TracePoint could not resolve this QR code." }, { status: 500 });
    vehicleInspectionEligible = eligible.data === true;
  } else {
    const rules = await admin.from("fleet_rules").select("inspection_role_codes").eq("department_id", departmentId).maybeSingle();
    if (rules.error) return NextResponse.json({ error: "TracePoint could not resolve this QR code." }, { status: 500 });
    vehicleInspectionEligible = canSubmitFleetInspection(resolved.context, rules.data);
  }
  // Restricted firearm custody (database/aws 031) exists only on AWS-native; the lookup mirrors its operator rule.
  const access = { ...context, vehicleInspectionEligible, restrictedFirearmCustody: awsNative };
  // QR values are opaque inputs. Candidate identifiers are resolved only inside the authorized tenant query.
  const records = await lookupQrRecords(admin, departmentId, parsed, access);
  if ("failure" in records) return records.failure === "ambiguous"
    ? NextResponse.json({ status: "unknown", message: "This code matches more than one record. Scan the TracePoint label for this item instead." }, { status: 409, headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "TracePoint could not resolve this QR code." }, { status: 500 });
  // Inventory items have no printed label kind; an unlabelled handle that matched no other readable record is tried as an
  // inventory item ID or SKU, for callers with an inventory permission only.
  let inventory: Record<string, unknown> | null = null;
  if (!parsed.kind && !records.vehicle && !records.equipment && !records.firearm &&
      access.permissions.some((p: string) => ["view_inventory", "manage_inventory", "adjust_inventory", "administer_department"].includes(p))) {
    const candidates = await admin.from("inventory_items").select("id,name,sku,is_active").eq("department_id", departmentId).eq("is_active", true).or(qrLookupFilter(parsed.handle, ["sku"]));
    if (candidates.error) return NextResponse.json({ error: "Inventory QR lookup is unavailable." }, { status: 503 });
    const matches = Array.isArray(candidates.data) ? candidates.data as Record<string, unknown>[] : [];
    if (matches.length > 1) return NextResponse.json({ status: "unknown", message: "This code matches more than one record. Scan the TracePoint label for this item instead." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    inventory = matches[0] ?? null;
  }
  return NextResponse.json(qrDecision({ identifier: parsed.handle, access, ...records, inventory }), { headers: { "Cache-Control": "no-store" } });
}
