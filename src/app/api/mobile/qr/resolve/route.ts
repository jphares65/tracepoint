import { NextResponse } from "next/server";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { canSubmitFleetInspection } from "@/lib/tracepoint/fleet-server";
import { lookupQrRecords, parseQrIdentifier, qrDecision } from "@/lib/tracepoint/mobile-workflows";
export const dynamic = "force-dynamic";
const identifier = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 2048) : "";
export async function POST(request: Request) {
  const resolved = await resolveServerAccess(request); if (!resolved.ok) return accessFailureResponse(resolved);
  const value = identifier((await request.json().catch(() => ({})) as { identifier?: unknown }).identifier);
  const parsed = parseQrIdentifier(value);
  if (!parsed) return NextResponse.json({ status: "unknown", message: "This QR code is not valid." }, { status: 400 });
  const { admin, departmentId, ...context } = resolved.context;
  // Vehicle access follows the inspection-eligibility rule: on AWS-native the database rule (045) is authoritative,
  // because RLS may hide fleet_rules from the caller; in bridge mode the service-role client reads the rules.
  let vehicleInspectionEligible: boolean;
  if (process.env.TRACEPOINT_DATA_PROVIDER === "postgres") {
    const eligible = await admin.rpc("can_submit_fleet_inspection", { p_department_id: departmentId });
    if (eligible.error) return NextResponse.json({ error: "TracePoint could not resolve this QR code." }, { status: 500 });
    vehicleInspectionEligible = eligible.data === true;
  } else {
    const rules = await admin.from("fleet_rules").select("inspection_role_codes").eq("department_id", departmentId).maybeSingle();
    if (rules.error) return NextResponse.json({ error: "TracePoint could not resolve this QR code." }, { status: 500 });
    vehicleInspectionEligible = canSubmitFleetInspection(resolved.context, rules.data);
  }
  const access = { ...context, vehicleInspectionEligible };
  // QR values are opaque inputs. Candidate identifiers are resolved only inside the authorized tenant query.
  const records = await lookupQrRecords(admin, departmentId, parsed, access);
  if ("failure" in records) return records.failure === "ambiguous"
    ? NextResponse.json({ status: "unknown", message: "This code matches more than one record. Scan the TracePoint label for this item instead." }, { status: 409, headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "TracePoint could not resolve this QR code." }, { status: 500 });
  return NextResponse.json(qrDecision({ identifier: parsed.handle, access, ...records }), { headers: { "Cache-Control": "no-store" } });
}
