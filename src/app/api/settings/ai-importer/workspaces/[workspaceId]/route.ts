/* eslint-disable @typescript-eslint/no-explicit-any -- Workspace tables are pending generated Supabase types until the additive migration is applied. */
import { NextResponse } from "next/server";

import { loadWorkspace } from "@/lib/ai-importer/server/workspace-repository";
import { parseWorkspaceState } from "@/lib/ai-importer/server/workspace-state";
import { accessFailureResponse, hasServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(_request: Request, context: Context) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasServerPermission(access.context, "administer_department")) return permissionDeniedResponse("Department administration permission is required to view migration workspaces.");
  const { workspaceId } = await context.params;
  const workspace = await loadWorkspace(access.context.admin as any, workspaceId, access.context.departmentId);
  if (!workspace) return NextResponse.json({ error: "Migration workspace was not found in the active agency." }, { status: 404 });
  return NextResponse.json({ workspace }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: Context) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasServerPermission(access.context, "administer_department")) return permissionDeniedResponse("Department administration permission is required to update migration workspaces.");
  try {
    const { workspaceId } = await context.params;
    const existing = await loadWorkspace(access.context.admin as any, workspaceId, access.context.departmentId);
    if (!existing) return NextResponse.json({ error: "Migration workspace was not found in the active agency." }, { status: 404 });
    if (["completed", "expired"].includes(existing.status)) return NextResponse.json({ error: "This migration workspace is no longer editable." }, { status: 409 });
    const body = await request.json();
    const state = parseWorkspaceState(body?.state);
    const existingBySource = new Map(existing.state.sources.map((source) => [source.id, source]));
    const immutableSourcesMatch = state.sources.length === existing.state.sources.length && state.sources.every((source) => {
      const prior = existingBySource.get(source.id);
      return Boolean(prior && prior.fileId === source.fileId && prior.sheetName === source.sheetName && prior.uploadedAt === source.uploadedAt && JSON.stringify(prior.file) === JSON.stringify(source.file) && JSON.stringify(prior.matrix) === JSON.stringify(source.matrix));
    });
    if (!immutableSourcesMatch) return NextResponse.json({ error: "Staged source records are immutable. Use workspace mappings and remediation rules to correct values." }, { status: 409 });
    const admin = access.context.admin as any;
    const nextStatus = existing.completedDomains.length ? "partially_completed" : "draft";
    const result = await admin.from("ai_migration_workspaces").update({ state, status: nextStatus, last_validation_digest: null, file_count: new Set(state.sources.map((source) => source.fileId)).size, source_row_count: state.sources.reduce((sum, source) => sum + Math.max(0, source.matrix.length - source.headerRow), 0), updated_by_user_id: access.context.userId, updated_at: new Date().toISOString() }).eq("id", workspaceId).eq("department_id", access.context.departmentId).select("updated_at").single();
    if (result.error) throw new Error("Migration workspace changes could not be saved.");
    return NextResponse.json({ workspace: { ...existing, state, status: nextStatus, updatedAt: result.data.updated_at } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Migration workspace could not be updated." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasServerPermission(access.context, "administer_department")) return permissionDeniedResponse("Department administration permission is required to remove migration workspaces.");
  const { workspaceId } = await context.params;
  const admin = access.context.admin as any;
  const result = await admin.from("ai_migration_workspaces").delete().eq("id", workspaceId).eq("department_id", access.context.departmentId);
  if (result.error) return NextResponse.json({ error: "Migration workspace could not be removed." }, { status: 500 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
