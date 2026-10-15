import { NextResponse } from "next/server";
import { accessFailureResponse, hasAnyServerPermission, hasServerFeature, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { authorizeRangeWorkspaceMutation } from "@/lib/range/workspace-mutation";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ rangeDayId: string }> };
type Row = Record<string, unknown>;
function rows(value: unknown): Row[] { return Array.isArray(value) ? value.filter((v): v is Row => v && typeof v === "object") : []; }
function asRecord(value: unknown): Row { return value && typeof value === "object" ? value as Row : {}; }
export async function PATCH(request: Request, context: Context) {
  const resolved = await resolveServerAccess(request);
  if (!resolved.ok) return accessFailureResponse(resolved);
  const ctx = resolved.context;
  if (!(hasServerFeature(ctx, "range_training") || hasServerFeature(ctx, "qualifications")) || !hasAnyServerPermission(ctx, ["manage_range_days"]))
    return NextResponse.json({ error: "Range management permission is required to update attendance." }, { status: 403 });
  const { rangeDayId } = await context.params;
  const body = asRecord(await request.json().catch(() => ({})));
  const rosterId = typeof body.rosterId === "string" ? body.rosterId : "";
  if (!rangeDayId || !rosterId || typeof body.attended !== "boolean") return NextResponse.json({ error: "Range Day, roster entry and attendance status are required." }, { status: 400 });
  const existing = await ctx.admin.from("pilot_range_workspaces").select("workspace,updated_at").eq("department_id", ctx.departmentId).maybeSingle();
  if (existing.error || !existing.data) return NextResponse.json({ error: "The Range Day workspace could not be loaded." }, { status: 500 });
  const previous = asRecord(existing.data.workspace);
  const days = rows(previous.rangeDays ?? previous.range_days);
  const rangeDay = days.find((v) => String(v.id ?? "") === rangeDayId);
  if (!rangeDay) return NextResponse.json({ error: "Range Day not found." }, { status: 404 });
  const status = String(rangeDay.status ?? "").toLowerCase();
  if (["completed", "locked", "archived"].includes(status) || String(rangeDay.packetStatus ?? rangeDay.packet_status ?? "").toLowerCase() === "ready") return NextResponse.json({ error: "Finalized Range Day attendance cannot be changed." }, { status: 409 });
  const rosterKey = Array.isArray(previous.rangeRoster) ? "rangeRoster" : "range_roster";
  const roster = rows(previous[rosterKey]);
  const matches = roster.filter((v) => String(v.id ?? "") === rosterId && String(v.rangeDayId ?? v.range_day_id ?? "") === rangeDayId);
  if (matches.length !== 1) return NextResponse.json({ error: "Attendance entry not found or ambiguous." }, { status: 404 });
  const nextRoster = roster.map((v) => v === matches[0] ? { ...v, attended: body.attended } : v);
  const nextWorkspace = { ...previous, [rosterKey]: nextRoster };
  const decision = authorizeRangeWorkspaceMutation({ existingWorkspace: previous, nextWorkspace, departmentId: ctx.departmentId, permissions: ctx.permissions });
  if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });
  const last = Date.parse(String(existing.data.updated_at ?? ""));
  const updatedAt = new Date(Math.max(Date.now(), Number.isFinite(last) ? last + 1 : 0)).toISOString();
  const write = await ctx.admin.from("pilot_range_workspaces").update({ workspace: nextWorkspace, updated_by_user_id: ctx.userId, updated_at: updatedAt }).eq("department_id", ctx.departmentId).eq("updated_at", existing.data.updated_at).select("department_id").maybeSingle();
  if (write.error || !write.data) return NextResponse.json({ error: "Attendance changed before it could be saved. Refresh and retry." }, { status: 409 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
