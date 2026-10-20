import { NextResponse } from "next/server";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { lookupQrRecords, parseQrIdentifier, qrDecision } from "@/lib/tracepoint/mobile-workflows";
export const dynamic = "force-dynamic";
const identifier = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 2048) : "";
export async function POST(request: Request) {
  const resolved = await resolveServerAccess(request); if (!resolved.ok) return accessFailureResponse(resolved);
  const value = identifier((await request.json().catch(() => ({})) as { identifier?: unknown }).identifier);
  const parsed = parseQrIdentifier(value);
  if (!parsed) return NextResponse.json({ status: "unknown", message: "This QR code is not valid." }, { status: 400 });
  const { admin, departmentId, ...access } = resolved.context;
  // QR values are opaque inputs. Candidate identifiers are resolved only inside the authorized tenant query.
  const records = await lookupQrRecords(admin, departmentId, parsed, access);
  if ("failure" in records) return records.failure === "ambiguous"
    ? NextResponse.json({ status: "unknown", message: "This code matches more than one record. Scan the TracePoint label for this item instead." }, { status: 409, headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "TracePoint could not resolve this QR code." }, { status: 500 });
  return NextResponse.json(qrDecision({ identifier: parsed.handle, access, ...records }), { headers: { "Cache-Control": "no-store" } });
}
