/* eslint-disable @typescript-eslint/no-explicit-any -- Workspace tables are pending generated Supabase types until the additive migration is applied. */
import { NextResponse } from "next/server";

import { explicitApprovalComplete } from "@/lib/ai-importer/approval";
import { verifyWorkspaceApprovalToken, workspaceDigest } from "@/lib/ai-importer/fingerprint";
import { executeApprovedImport } from "@/lib/ai-importer/server/execution";
import { loadImportReferenceData } from "@/lib/ai-importer/server/reference-data";
import { loadWorkspace } from "@/lib/ai-importer/server/workspace-repository";
import { buildWorkspacePlans, readyDomains, WORKSPACE_DEPENDENCIES } from "@/lib/ai-importer/workspace";
import { IMPORT_DOMAINS, type ImportDomain, type ImportExecutionResult, type ImportReferenceData } from "@/lib/ai-importer/types";
import { accessFailureResponse, hasServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ workspaceId: string }> };

export async function POST(request: Request, context: Context) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasServerPermission(access.context, "administer_department")) return permissionDeniedResponse("Department administration permission is required to execute migration workspaces.");
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || !explicitApprovalComplete(body.approval)) return NextResponse.json({ error: "Explicit approval of the workspace plan and final import action is required." }, { status: 400 });
    const { workspaceId } = await context.params;
    const admin = access.context.admin as any;
    const workspace = await loadWorkspace(admin, workspaceId, access.context.departmentId);
    if (!workspace) return NextResponse.json({ error: "Migration workspace was not found in the active agency." }, { status: 404 });
    const selected: ImportDomain[] = Array.isArray(body.domains) ? body.domains.filter((domain: unknown): domain is ImportDomain => IMPORT_DOMAINS.includes(domain as ImportDomain)) : [];
    if (!selected.length || selected.length !== body.domains.length || new Set(selected).size !== selected.length) throw new Error("Select one or more distinct supported ready domains.");
    if (selected.some((domain) => workspace.completedDomains.includes(domain))) return NextResponse.json({ error: "A selected domain was already completed in this workspace." }, { status: 409 });
    const loadReferences = async () => Object.fromEntries(await Promise.all(IMPORT_DOMAINS.map(async (domain) => [domain, await loadImportReferenceData(access.context.admin, access.context.departmentId, domain)] as const))) as Record<ImportDomain, ImportReferenceData>;
    let references = await loadReferences();
    let plans = buildWorkspacePlans(workspace.state, references);
    const currentDigest = workspaceDigest(workspaceId, workspace.state, plans.map((plan) => ({ domain: plan.domain, payload: plan.payload, rows: plan.preview.rows, summary: plan.preview.summary })));
    const token = typeof body.approvalToken === "string" ? body.approvalToken : "";
    const approvedDigest = typeof body.workspaceDigest === "string" ? body.workspaceDigest : "";
    if (currentDigest !== approvedDigest || !verifyWorkspaceApprovalToken(token, workspaceId, workspace.state, approvedDigest, access.context.departmentId, access.context.userId)) return NextResponse.json({ error: "This approval is stale or does not match the active agency workspace. Validate and approve the plan again." }, { status: 409 });
    const available = new Set(readyDomains(plans));
    const plannedDomains = new Set(plans.map((plan) => plan.domain));
    for (const domain of selected) {
      if (!available.has(domain)) return NextResponse.json({ error: `${domain} is not ready for import.` }, { status: 409 });
      for (const dependency of WORKSPACE_DEPENDENCIES[domain] ?? []) if (plannedDomains.has(dependency) && !selected.includes(dependency) && !workspace.completedDomains.includes(dependency)) return NextResponse.json({ error: `${domain} depends on ${dependency}. Import the dependency in the same run or complete it first.` }, { status: 409 });
    }
    const order = IMPORT_DOMAINS.filter((domain) => selected.includes(domain)).sort((left, right) => (left === "personnel" ? -1 : right === "personnel" ? 1 : 0));
    const results: Partial<Record<ImportDomain, ImportExecutionResult>> = {};
    for (const domain of order) {
      if ((WORKSPACE_DEPENDENCIES[domain] ?? []).some((dependency) => results[dependency]?.failed)) break;
      if (domain !== order[0]) {
        references = await loadReferences();
        plans = buildWorkspacePlans(workspace.state, references);
      }
      const plan = plans.find((candidate) => candidate.domain === domain);
      if (!plan || plan.preview.summary.blocked > 0) throw new Error(`${domain} changed during dependency execution and must be validated again.`);
      const sources = workspace.state.sources.filter((source) => !source.excluded && source.domain === domain);
      results[domain] = await executeApprovedImport(admin, plan.payload, access.context.departmentId, access.context.userId, plan.preview.rows, {
        workspaceId, sourceFiles: sources.map((source) => ({ filename: source.file.name, sha256: source.file.sha256, sheet: source.sheetName })),
        mappings: sources.flatMap((source) => source.mappings.map((mapping) => ({ sourceId: source.id, sourceColumn: mapping.sourceColumn, targetField: mapping.targetField, confidence: mapping.confidence }))),
        remediations: workspace.state.remediations.filter((rule) => sources.some((source) => source.id === rule.sourceId)),
        mergeRules: workspace.state.mergeRules.filter((rule) => rule.domain === domain),
      });
    }
    const completedDomains = [...new Set([...workspace.completedDomains, ...order.filter((domain) => results[domain]?.failed === 0)])];
    const remaining = new Set(workspace.state.sources.filter((source) => !source.excluded).map((source) => source.domain));
    const completed = [...remaining].every((domain) => completedDomains.includes(domain));
    await admin.from("ai_migration_workspaces").update({ status: completed ? "completed" : "partially_completed", completed_domains: completedDomains, completed_at: completed ? new Date().toISOString() : null, updated_at: new Date().toISOString(), updated_by_user_id: access.context.userId, last_validation_digest: null }).eq("id", workspaceId).eq("department_id", access.context.departmentId);
    return NextResponse.json({ ok: Object.values(results).every((result) => result?.failed === 0), results, completedDomains, status: completed ? "completed" : "partially_completed" }, { status: Object.values(results).some((result) => result?.failed) ? 207 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Migration workspace could not be executed." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
