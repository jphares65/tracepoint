/* eslint-disable @typescript-eslint/no-explicit-any -- Workspace tables are pending generated Supabase types until the additive migration is applied. */
import { NextResponse } from "next/server";

import { workspaceApprovalToken, workspaceDigest } from "@/lib/ai-importer/fingerprint";
import { loadImportReferenceData } from "@/lib/ai-importer/server/reference-data";
import { loadWorkspace } from "@/lib/ai-importer/server/workspace-repository";
import { buildWorkspacePlans, readyDomains, workspaceDashboard } from "@/lib/ai-importer/workspace";
import { IMPORT_DOMAINS, type ImportDomain, type ImportReferenceData } from "@/lib/ai-importer/types";
import { accessFailureResponse, hasServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ workspaceId: string }> };

export async function POST(_request: Request, context: Context) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasServerPermission(access.context, "administer_department")) return permissionDeniedResponse("Department administration permission is required to validate migration workspaces.");
  try {
    const { workspaceId } = await context.params;
    const admin = access.context.admin as any;
    const workspace = await loadWorkspace(admin, workspaceId, access.context.departmentId);
    if (!workspace) return NextResponse.json({ error: "Migration workspace was not found in the active agency." }, { status: 404 });
    if (workspace.status === "expired" || new Date(workspace.expiresAt) <= new Date()) return NextResponse.json({ error: "This migration workspace has expired." }, { status: 410 });
    const entries = await Promise.all(IMPORT_DOMAINS.map(async (domain) => [domain, await loadImportReferenceData(access.context.admin, access.context.departmentId, domain)] as const));
    const references = Object.fromEntries(entries) as Record<ImportDomain, ImportReferenceData>;
    const plans = buildWorkspacePlans(workspace.state, references);
    const digest = workspaceDigest(workspaceId, workspace.state, plans.map((plan) => ({ domain: plan.domain, payload: plan.payload, rows: plan.preview.rows, summary: plan.preview.summary })));
    const ready = readyDomains(plans).filter((domain) => !workspace.completedDomains.includes(domain));
    const status = workspace.completedDomains.length ? "partially_completed" : plans.every((plan) => plan.preview.summary.blocked === 0) ? "ready" : "draft";
    const saved = await admin.from("ai_migration_workspaces").update({ status, last_validation_digest: digest, updated_by_user_id: access.context.userId, updated_at: new Date().toISOString() }).eq("id", workspaceId).eq("department_id", access.context.departmentId);
    if (saved.error) throw new Error("The validated migration plan could not be saved.");
    return NextResponse.json({
      workspaceId, status, dashboard: workspaceDashboard(workspace.state, plans), readyDomains: ready, completedDomains: workspace.completedDomains,
      plans: plans.map((plan) => ({ domain: plan.domain, uniqueRecords: plan.uniqueRecords, preview: plan.preview, overlaps: plan.overlaps, provenance: plan.provenance, dependencies: plan.domain === "personnel" || plan.domain === "vehicles" ? [] : ["personnel"] })),
      approvalToken: workspaceApprovalToken(workspaceId, workspace.state, digest, access.context.departmentId, access.context.userId), workspaceDigest: digest,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Migration workspace could not be validated." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
