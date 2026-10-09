import { NextResponse } from "next/server";
import { accessFailureResponse, hasAnyServerPermission, hasServerFeature, resolveServerAccess, type ServerAccessContext } from "@/lib/tracepoint/server-access";
import { createRangeReadRepository } from "@/lib/range/read-repository";
import { authorizeRangeWorkspaceMutation } from "@/lib/range/workspace-mutation";
export const dynamic = "force-dynamic";
function permitted(context: ServerAccessContext) { return (hasServerFeature(context, "range_training") || hasServerFeature(context, "qualifications")) && hasAnyServerPermission(context, ["manage_range_days", "score_range_days", "manage_qualifications"]); }
export async function GET(request: Request) {
  const resolved = await resolveServerAccess(request); if (!resolved.ok) return accessFailureResponse(resolved); if (!permitted(resolved.context)) return NextResponse.json({ error: "You are not authorized to access live scoring." }, { status: 403 });
  try {
    const repository = createRangeReadRepository(resolved.context.admin, resolved.context.departmentId);
    const [workspace, people] = await Promise.all([repository.getWorkspace(resolved.context.departmentId), repository.getPersonnel(resolved.context.departmentId)]);
    const labels = new Map<string, Record<string, unknown>>(people.profiles.map((profile) => [String(profile.id), profile]));
    return NextResponse.json({ userId: resolved.context.userId, workspace: workspace.workspace ?? {}, personnel: people.memberships.map((membership) => { const person = labels.get(String(membership.user_id)); return { id: String(membership.user_id), userId: String(membership.user_id), displayName: String(person?.full_name ?? person?.email ?? "TracePoint officer"), badgeNumber: membership.badge_number ?? null }; }) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Live scoring could not be loaded." }, { status: 500 }); }
}
export async function PUT(request: Request) {
  const resolved = await resolveServerAccess(request); if (!resolved.ok) return accessFailureResponse(resolved); if (!permitted(resolved.context)) return NextResponse.json({ error: "You are not authorized to save live scores." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { workspace?: unknown }; const workspace = body.workspace;
  if (!workspace || typeof workspace !== "object") return NextResponse.json({ error: "A scoring workspace is required." }, { status: 400 });
  const existing = await resolved.context.admin.from("pilot_range_workspaces").select("workspace,updated_at").eq("department_id", resolved.context.departmentId).maybeSingle();
  if (existing.error) return NextResponse.json({ error: "The current scoring workspace could not be loaded." }, { status: 500 });
  const decision = authorizeRangeWorkspaceMutation({ existingWorkspace: existing.data?.workspace ?? {}, nextWorkspace: workspace, departmentId: resolved.context.departmentId, permissions: resolved.context.permissions });
  if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });
  const updatedAt = new Date(Math.max(Date.now(), existing.data ? Date.parse(existing.data.updated_at) + 1 : 0)).toISOString();
  const write = existing.data ? await resolved.context.admin.from("pilot_range_workspaces").update({ workspace, updated_by_user_id: resolved.context.userId, updated_at: updatedAt }).eq("department_id", resolved.context.departmentId).eq("updated_at", existing.data.updated_at).select("department_id").maybeSingle() : await resolved.context.admin.from("pilot_range_workspaces").insert({ department_id: resolved.context.departmentId, workspace, updated_by_user_id: resolved.context.userId, updated_at: updatedAt }).select("department_id").maybeSingle();
  if (write.error || !write.data) return NextResponse.json({ error: "Scores changed before they could be saved. Reload and try again." }, { status: 409 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
