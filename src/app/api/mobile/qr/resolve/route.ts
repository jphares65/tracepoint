import { NextResponse } from "next/server";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { qrDecision } from "@/lib/tracepoint/mobile-workflows";
export const dynamic = "force-dynamic";
const identifier = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 2048) : "";
const opaqueHandle = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
export async function POST(request: Request) {
  const resolved = await resolveServerAccess(); if (!resolved.ok) return accessFailureResponse(resolved);
  const value = identifier((await request.json().catch(() => ({})) as { identifier?: unknown }).identifier);
  if (!opaqueHandle.test(value)) return NextResponse.json({ status: "unknown", message: "This QR code is not valid." }, { status: 400 });
  const { admin, departmentId, ...access } = resolved.context;
  // QR values are opaque inputs. Candidate identifiers are resolved only inside the authorized tenant query.
  const [vehicle, equipment, firearm] = await Promise.all([
    admin.from("fleet_vehicles").select("id,unit_number,vin,status").eq("department_id", departmentId).or(`id.eq.${value},unit_number.eq.${value},vin.eq.${value}`).maybeSingle(),
    admin.from("equipment_assets").select("id,manufacturer,model,serial_number,asset_number,lifecycle_status").eq("department_id", departmentId).neq("lifecycle_status", "removed").or(`id.eq.${value},asset_number.eq.${value},serial_number.eq.${value}`).maybeSingle(),
    admin.from("firearms").select("id,serial_number,asset_number,is_active").eq("department_id", departmentId).eq("is_active", true).or(`id.eq.${value},asset_number.eq.${value},serial_number.eq.${value}`).maybeSingle(),
  ]);
  if (vehicle.error || equipment.error || firearm.error) return NextResponse.json({ error: "TracePoint could not resolve this QR code." }, { status: 500 });
  return NextResponse.json(qrDecision({ identifier: value, access, vehicle: vehicle.data, equipment: equipment.data, firearm: firearm.data }), { headers: { "Cache-Control": "no-store" } });
}
