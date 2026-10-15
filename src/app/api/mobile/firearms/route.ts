import { NextResponse } from "next/server";
import { createArmoryReadRepository } from "@/lib/armory/read-repository";
import { accessFailureResponse, hasAnyServerPermission, hasServerFeature, resolveServerAccess } from "@/lib/tracepoint/server-access";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const resolved = await resolveServerAccess(request);
  if (!resolved.ok) return accessFailureResponse(resolved);
  const ctx = resolved.context;
  if (!hasServerFeature(ctx, "firearms")) return NextResponse.json({ error: "Firearms are unavailable for this agency." }, { status: 403 });
  const canViewAll = hasAnyServerPermission(ctx, ["manage_firearms", "manage_inspections", "view_command_dashboard"]);
  const id = new URL(request.url).searchParams.get("id")?.trim() || "";
  try {
    if (id) {
      if (!hasAnyServerPermission(ctx, ["firearm_custody.check_out", "firearm_custody.check_in", "manage_firearms"])) return NextResponse.json({ error: "Firearm custody access required." }, { status: 403 });
      const record = await ctx.admin.from("firearms").select("id,make,model,serial_number,asset_number,condition_status").eq("department_id",ctx.departmentId).eq("id",id).eq("is_active",true).maybeSingle();
      if (record.error) return NextResponse.json({ error: "Firearm record unavailable." }, { status: 500 });
      return NextResponse.json({ items: record.data ? [record.data] : [] }, { headers: { "Cache-Control": "no-store" } });
    }
    const payload = await createArmoryReadRepository(ctx.db, ctx.admin, ctx.departmentId, ctx.userId).getFirearmInventory({ departmentId: ctx.departmentId, userId: ctx.userId, includeArchived: false, canViewAll, canManage: hasAnyServerPermission(ctx, ["manage_firearms"]), canInspect: hasAnyServerPermission(ctx, ["manage_inspections", "manage_firearms"]) });
    // Personal assignments remain visible without broad department access.
    return NextResponse.json({ items: payload.firearms.map((v) => {
      const row: Record<string, unknown> = v;
      return {
        id: typeof row.id === "string" ? row.id : "",
        make: typeof row.make === "string" ? row.make : "",
        model: typeof row.model === "string" ? row.model : "",
        serial_number: typeof row.serial_number === "string" ? row.serial_number : "",
        asset_number: typeof row.asset_number === "string" ? row.asset_number : "",
        condition_status: typeof row.condition_status === "string" ? row.condition_status : "In Service",
        active_assignment: v.active_assignment
          ? { assigned_to_name: v.active_assignment.assigned_to_name }
          : null,
      };
    }).filter((record) => Boolean(record.id)) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Firearm records could not be loaded." }, { status: 500 }); }
}
