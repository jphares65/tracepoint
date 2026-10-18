import { NextResponse } from "next/server";
import { getDocumentField } from "@/lib/agency-documents/field-registry";
import { canCreateTemplateField, eligibleForBulkAccept, proposalToFieldRow, ProposalConversionError, type ReviewedProposal } from "@/lib/agency-documents/proposal-review";
import type { AnalysisProposal } from "@/lib/agency-documents/template-analyzer";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

type Context = { params: Promise<{ templateId: string }> };
type ProposalRow = { id: string; proposal: AnalysisProposal; status: string };
const manage = ["manage_document_templates"] as const;

export async function GET(_request: Request, route: Context) {
  const access = await resolveServerAccess(); if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, manage)) return permissionDeniedResponse();
  const { templateId } = await route.params;
  const rows = await access.context.admin.from("document_template_analysis_proposals").select("id,proposal,status").eq("department_id", access.context.departmentId).eq("template_id", templateId).order("created_at");
  return rows.error ? NextResponse.json({ error: "Suggestions could not be loaded." }, { status: 500 }) : NextResponse.json({ proposals: rows.data ?? [] });
}

export async function PATCH(request: Request, route: Context) {
  const access = await resolveServerAccess(); if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, manage)) return permissionDeniedResponse();
  const { admin, departmentId, userId } = access.context;
  const { templateId } = await route.params;
  const body = await request.json().catch(() => ({})) as { action?: string; proposalIds?: string[]; proposal?: ReviewedProposal };

  if (body.action === "update" && body.proposalIds?.[0] && body.proposal) {
    if (body.proposal.suggestedSemanticKey && !getDocumentField(body.proposal.suggestedSemanticKey)) return NextResponse.json({ error: "That field is not available." }, { status: 400 });
    const update = await admin.from("document_template_analysis_proposals").update({ proposal: body.proposal, status: "modified" }).eq("id", body.proposalIds[0]).eq("department_id", departmentId).eq("template_id", templateId);
    return update.error ? NextResponse.json({ error: "Suggestion could not be saved." }, { status: 500 }) : NextResponse.json({ ok: true });
  }

  const all = await admin.from("document_template_analysis_proposals").select("id,proposal,status").eq("department_id", departmentId).eq("template_id", templateId).in("status", ["proposed", "modified"]);
  if (all.error) return NextResponse.json({ error: "Suggestions could not be loaded." }, { status: 500 });
  const rows = (all.data ?? []) as ProposalRow[];
  let selected = rows.filter((row) => (body.action === "accept-high" ? eligibleForBulkAccept(row.proposal) : (body.proposalIds ?? []).includes(row.id)));
  if (body.action === "reject-all") selected = rows;

  if (body.action === "reject" || body.action === "reject-all") {
    if (!selected.length) return NextResponse.json({ ok: true, count: 0 });
    const update = await admin.from("document_template_analysis_proposals").update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by_user_id: userId }).eq("department_id", departmentId).in("id", selected.map((row) => row.id));
    return update.error ? NextResponse.json({ error: "Suggestion could not be ignored." }, { status: 500 }) : NextResponse.json({ ok: true, count: selected.length });
  }

  selected = selected.filter((row) => canCreateTemplateField(row.proposal));
  if (!selected.length) return NextResponse.json({ ok: true, count: 0 });
  const template = await admin.from("document_templates").select("current_version").eq("id", templateId).eq("department_id", departmentId).maybeSingle();
  if (template.error || !template.data) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  const version = await admin.from("document_template_versions").select("id").eq("template_id", templateId).eq("department_id", departmentId).eq("version_number", template.data.current_version).single();
  if (version.error) return NextResponse.json({ error: "The template version could not be loaded." }, { status: 500 });

  let fields;
  try {
    // Explicit acceptance by a person confirms the mapping.
    fields = selected.map((row) => ({ ...proposalToFieldRow(row.proposal as ReviewedProposal, row.status === "modified" ? "modified" : "accepted"), department_id: departmentId, template_version_id: version.data.id }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof ProposalConversionError ? error.message : "Suggestion could not be accepted." }, { status: 400 });
  }
  const insert = await admin.from("document_template_fields").insert(fields);
  if (insert.error) return NextResponse.json({ error: "Suggestion could not be accepted. Your template was not changed." }, { status: 500 });
  await admin.from("document_template_analysis_proposals").update({ status: "accepted", reviewed_at: new Date().toISOString(), reviewed_by_user_id: userId }).eq("department_id", departmentId).in("id", selected.map((row) => row.id));
  return NextResponse.json({ ok: true, count: fields.length });
}
