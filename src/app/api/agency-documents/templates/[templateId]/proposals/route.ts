import { NextResponse } from "next/server";
import { getDocumentField } from "@/lib/agency-documents/field-registry";
import { fieldLocator } from "@/lib/agency-documents/field-persistence";
import { canCreateTemplateField, eligibleForBulkAccept, mergeProposalUpdate, proposalToFieldRow, ProposalConversionError, sharedSourceKeys, type ReviewedProposal } from "@/lib/agency-documents/proposal-review";
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

  // A published template is what people generate from; its fields and sections change only after unpublishing.
  const template = await admin.from("document_templates").select("status,current_version").eq("id", templateId).eq("department_id", departmentId).maybeSingle();
  if (template.error) return NextResponse.json({ error: "Template could not be loaded." }, { status: 500 });
  if (!template.data) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  if (template.data.status === "published") return NextResponse.json({ error: "Unpublish this template before changing its fields." }, { status: 409 });

  if (body.action === "update" && body.proposalIds?.[0] && body.proposal) {
    if (body.proposal.suggestedSemanticKey && !getDocumentField(body.proposal.suggestedSemanticKey)) return NextResponse.json({ error: "That field is not available." }, { status: 400 });
    const stored = await admin.from("document_template_analysis_proposals").select("id,proposal,status").eq("id", body.proposalIds[0]).eq("department_id", departmentId).eq("template_id", templateId).maybeSingle();
    if (stored.error) return NextResponse.json({ error: "Suggestion could not be loaded." }, { status: 500 });
    if (!stored.data || (stored.data.status !== "proposed" && stored.data.status !== "modified")) return NextResponse.json({ error: "That suggestion is no longer open." }, { status: 404 });
    // Only the decision can be edited; what was detected on the form is kept from the stored proposal.
    const merged = mergeProposalUpdate(stored.data.proposal as ReviewedProposal, body.proposal);
    const update = await admin.from("document_template_analysis_proposals").update({ proposal: merged, status: "modified" }).eq("id", body.proposalIds[0]).eq("department_id", departmentId).eq("template_id", templateId);
    return update.error ? NextResponse.json({ error: "Suggestion could not be saved." }, { status: 500 }) : NextResponse.json({ ok: true });
  }

  const all = await admin.from("document_template_analysis_proposals").select("id,proposal,status").eq("department_id", departmentId).eq("template_id", templateId).in("status", ["proposed", "modified"]);
  if (all.error) return NextResponse.json({ error: "Suggestions could not be loaded." }, { status: 500 });
  const rows = (all.data ?? []) as ProposalRow[];
  const sharedKeys = sharedSourceKeys(rows.map((row) => row.proposal));
  let selected = rows.filter((row) => (body.action === "accept-high" ? eligibleForBulkAccept(row.proposal, sharedKeys) : (body.proposalIds ?? []).includes(row.id)));
  // Repeating sections are dismissed one at a time, deliberately; "ignore all" leaves them for a decision.
  if (body.action === "reject-all") selected = rows.filter((row) => row.proposal?.kind !== "structured_section");

  if (body.action === "reject" || body.action === "reject-all") {
    if (!selected.length) return NextResponse.json({ ok: true, count: 0 });
    const update = await admin.from("document_template_analysis_proposals").update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by_user_id: userId }).eq("department_id", departmentId).in("id", selected.map((row) => row.id));
    return update.error ? NextResponse.json({ error: "Suggestion could not be ignored." }, { status: 500 }) : NextResponse.json({ ok: true, count: selected.length });
  }

  selected = selected.filter((row) => canCreateTemplateField(row.proposal));
  if (!selected.length) return NextResponse.json({ ok: true, count: 0 });
  const version = await admin.from("document_template_versions").select("id").eq("template_id", templateId).eq("department_id", departmentId).eq("version_number", template.data.current_version).single();
  if (version.error) return NextResponse.json({ error: "The template version could not be loaded." }, { status: 500 });

  let fields;
  try {
    // Explicit acceptance by a person confirms the mapping.
    fields = selected.map((row) => ({ ...proposalToFieldRow(row.proposal as ReviewedProposal, row.status === "modified" ? "modified" : "accepted"), department_id: departmentId, template_version_id: version.data.id }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof ProposalConversionError ? error.message : "Suggestion could not be accepted." }, { status: 400 });
  }
  // A place on the form holds one field. Accepting a suggestion for a place that already has a field would
  // write it twice (Word) or let one value overwrite the other (PDF).
  const existingFields = await admin.from("document_template_fields").select("formatting").eq("template_version_id", version.data.id).eq("department_id", departmentId);
  if (existingFields.error) return NextResponse.json({ error: "Template fields could not be checked." }, { status: 500 });
  const taken = new Set((existingFields.data ?? []).map((row: { formatting?: Record<string, unknown> | null }) => fieldLocator(row)).filter(Boolean));
  const accepted: typeof fields = [], acceptedIds: string[] = [], duplicates: string[] = [];
  fields.forEach((field, index) => {
    const locator = fieldLocator(field);
    if (locator && taken.has(locator)) { duplicates.push(selected[index]!.id); return; }
    if (locator) taken.add(locator);
    accepted.push(field); acceptedIds.push(selected[index]!.id);
  });
  if (!accepted.length) return NextResponse.json({ error: "This place on the form already has a field. Edit that field instead.", duplicates }, { status: 409 });
  fields = accepted;
  selected = selected.filter((row) => acceptedIds.includes(row.id));
  const insert = await admin.from("document_template_fields").insert(fields);
  if (insert.error) return NextResponse.json({ error: "Suggestion could not be accepted. Your template was not changed." }, { status: 500 });
  await admin.from("document_template_analysis_proposals").update({ status: "accepted", reviewed_at: new Date().toISOString(), reviewed_by_user_id: userId }).eq("department_id", departmentId).in("id", selected.map((row) => row.id));
  return NextResponse.json({ ok: true, count: fields.length, ...(duplicates.length ? { skipped: duplicates.length } : {}) });
}
