import { NextRequest, NextResponse } from "next/server";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { auditFleet, canManageFleet, nullableDate, nullableText, text } from "@/lib/tracepoint/fleet-server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ vehicleId: string }> }) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  const { data: rules } = await context.admin.from("fleet_rules").select("fleet_manager_role_codes").eq("department_id", context.departmentId).maybeSingle();
  if (!canManageFleet(context, rules)) return NextResponse.json({ error: "Fleet Manager access is required." }, { status: 403 });
  const { vehicleId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = text(body.title, 250);
  if (!title) return NextResponse.json({ error: "Document title is required." }, { status: 400 });
  const { data, error } = await context.admin.from("fleet_vehicle_documents").insert({
    department_id: context.departmentId, vehicle_id: vehicleId,
    document_type: text(body.documentType, 100) || "Other", title,
    document_url: nullableText(body.documentUrl, 2000), effective_date: nullableDate(body.effectiveDate),
    expiration_date: nullableDate(body.expirationDate), notes: nullableText(body.notes, 5000),
    created_by_user_id: context.user.id,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await auditFleet(context, "fleet_vehicle_document_added", "fleet_vehicle", vehicleId, { document: data });
  return NextResponse.json({ ok: true, item: data }, { status: 201 });
}
