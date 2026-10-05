import { NextRequest, NextResponse } from "next/server";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const result = await resolved.context.db.from("firearm_storage_locations").select("id,name,description,is_active,created_at").eq("department_id", resolved.context.departmentId).eq("is_active", true).order("name");
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  return NextResponse.json({ locations: result.data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  if (!hasAnyServerPermission(resolved.context, ["firearm_custody.manage_storage_locations", "manage_firearms"])) return permissionDeniedResponse("Storage-location permission is required.");
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const name = text(body.name);
  if (!name) return NextResponse.json({ error: "A storage location name is required." }, { status: 400 });
  const result = await resolved.context.db.rpc("create_firearm_storage_location", { p_name: name, p_description: text(body.description) });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: result.error.code === "42501" ? 403 : 409 });
  return NextResponse.json({ ok: true, storageLocationId: result.data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  if (!hasAnyServerPermission(resolved.context, ["firearm_custody.manage_storage_locations", "manage_firearms"])) return permissionDeniedResponse("Storage-location permission is required.");
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const locationId = text(body.locationId); const name = text(body.name);
  if (!uuid.test(locationId ?? "") || !name) return NextResponse.json({ error: "A location and name are required." }, { status: 400 });
  const result = await resolved.context.db.rpc("update_firearm_storage_location", { p_location_id: locationId, p_name: name, p_description: text(body.description) });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: result.error.code === "42501" ? 403 : 409 });
  return NextResponse.json({ ok: true, storageLocationId: result.data });
}

export async function DELETE(request: NextRequest) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  if (!hasAnyServerPermission(resolved.context, ["firearm_custody.manage_storage_locations", "manage_firearms"])) return permissionDeniedResponse("Storage-location permission is required.");
  const locationId = text((await request.json().catch(() => ({})) as Record<string, unknown>).locationId);
  if (!uuid.test(locationId ?? "")) return NextResponse.json({ error: "A valid location is required." }, { status: 400 });
  const result = await resolved.context.db.rpc("deactivate_firearm_storage_location", { p_location_id: locationId });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: result.error.code === "42501" ? 403 : 409 });
  return NextResponse.json({ ok: true, storageLocationId: result.data });
}
