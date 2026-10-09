import { NextResponse } from "next/server";
import { accessFailureResponse, hasAnyServerPermission, hasServerFeature, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { createRangeReadRepository } from "@/lib/range/read-repository";
import { rangeDayDetailPayload } from "@/lib/tracepoint/mobile-workflows";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ rangeDayId: string }> };
export async function GET(request: Request, context: Context) {
  const resolved = await resolveServerAccess(request); if (!resolved.ok) return accessFailureResponse(resolved);
  if (!hasServerFeature(resolved.context, "range_training") && !hasServerFeature(resolved.context, "qualifications")) return NextResponse.json({ error: "Range & Training is not enabled for this agency." }, { status: 403 });
  if (!hasAnyServerPermission(resolved.context, ["manage_range_days", "score_range_days", "manage_qualifications"])) return NextResponse.json({ error: "You are not authorized to view Range Days." }, { status: 403 });
  try {
    const { rangeDayId } = await context.params;
    const data = await createRangeReadRepository(resolved.context.admin, resolved.context.departmentId).getWorkspace(resolved.context.departmentId);
    const workspace = data.workspace as { drillLibrary?: unknown[] } | null;
    const templateIds = Array.isArray(workspace?.drillLibrary)
      ? workspace.drillLibrary.map((item) => item && typeof item === "object" ? String((item as { id?: unknown }).id ?? "") : "").filter(Boolean)
      : [];
    const documents = templateIds.length ? await resolved.context.admin.from("drill_documents").select("id,drill_template_id").eq("department_id", resolved.context.departmentId).in("drill_template_id", templateIds) : { data: [], error: null };
    if (documents.error) return NextResponse.json({ error: "Drill documents could not be loaded." }, { status: 500 });
    const ids = new Map<string, string[]>(); for (const document of documents.data ?? []) { const key = String(document.drill_template_id); ids.set(key, [...(ids.get(key) ?? []), String(document.id)]); }
    const detail = rangeDayDetailPayload(data.workspace, rangeDayId, ids); if (!detail) return NextResponse.json({ error: "Range Day not found." }, { status: 404 });
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Range Day could not be loaded." }, { status: 500 }); }
}
