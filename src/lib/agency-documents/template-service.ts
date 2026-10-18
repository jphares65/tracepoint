import { learnedMappingsFromFields } from "./learned-mappings";
import { analyzeTemplateDocx, analyzeTemplatePdf, type AnalysisResult } from "./template-analyzer";
import { templateFormat, type TemplateFormat } from "./document-generation";
import { analyzeScannedTemplatePdf } from "./visual-template-analyzer";
import type { LearnedMapping } from "./field-matcher";
import { attachmentPathFromMetadata, createObjectStore } from "@/lib/storage/object-store";

/**
 * Server-side orchestration shared by the analyze, setup, proof and generate
 * routes. Database access is passed in so the routes keep their existing
 * tenant-scoped clients.
 */

type Row = Record<string, unknown>;
type Filter = { eq(column: string, value: unknown): Filter; neq(column: string, value: unknown): Filter; in(column: string, values: unknown[]): Filter; then: PromiseLike<{ data: Row[] | null; error: unknown }>["then"] };
type Admin = { from(table: string): { select(columns: string): Filter } };

export class TemplateSourceError extends Error {
  constructor(message: string, readonly status = 500) { super(message); this.name = "TemplateSourceError"; }
}

export async function loadTemplateSource(admin: unknown, departmentId: string, storagePath: string): Promise<{ bytes: Uint8Array; format: TemplateFormat }> {
  const path = attachmentPathFromMetadata(storagePath, departmentId);
  if (!path) throw new TemplateSourceError("The template's source file is unavailable.", 404);
  const signed = await createObjectStore(admin as Parameters<typeof createObjectStore>[0], departmentId).createAttachmentView(path);
  if (signed.error || !signed.signedUrl) throw new TemplateSourceError("The template's source file could not be opened.");
  const response = await fetch(signed.signedUrl);
  if (!response.ok) throw new TemplateSourceError("The template's source file could not be read.", 502);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const format = templateFormat(bytes);
  if (!format) throw new TemplateSourceError("The template's source file is not a PDF or Word document.", 422);
  return { bytes, format };
}

/** Confirmed decisions from the agency's other templates. Failures degrade to "nothing learned", never block analysis. */
export async function loadLearnedMappings(admin: unknown, departmentId: string, excludeTemplateId: string): Promise<LearnedMapping[]> {
  try {
    const db = admin as Admin;
    const versions = await db.from("document_template_versions").select("id,template_id").eq("department_id", departmentId).neq("template_id", excludeTemplateId);
    if (versions.error || !versions.data?.length) return [];
    const templates = await db.from("document_templates").select("id,name").eq("department_id", departmentId);
    const names = new Map((templates.data ?? []).map((row) => [String(row.id), String(row.name ?? "")]));
    const versionTemplate = new Map(versions.data.map((row) => [String(row.id), String(row.template_id)]));
    const fields = await db.from("document_template_fields").select("field_type,canonical_key,formatting,template_version_id").eq("department_id", departmentId).in("template_version_id", [...versionTemplate.keys()]);
    if (fields.error) return [];
    return learnedMappingsFromFields((fields.data ?? []).map((row) => ({ field_type: String(row.field_type), canonical_key: (row.canonical_key as string | null) ?? null, formatting: (row.formatting as Record<string, unknown> | null) ?? null, template_name: names.get(versionTemplate.get(String(row.template_version_id)) ?? "") ?? null })));
  } catch {
    return [];
  }
}

/**
 * Analyze a template. Fillable PDFs and Word documents are analyzed
 * deterministically. Flat/scanned PDFs fall back to the existing visual path,
 * whose results are always suggestions for review.
 */
export async function analyzeTemplateSource(bytes: Uint8Array, format: TemplateFormat, learned: readonly LearnedMapping[]): Promise<AnalysisResult> {
  if (format === "docx") return analyzeTemplateDocx(bytes, { learned });
  const native = await analyzeTemplatePdf(bytes, { learned });
  if (native.proposals.length || !native.scanned) return native;
  let result = await analyzeScannedTemplatePdf(bytes);
  // The optional vision provider is loaded only when configured, so environments without it never import the AWS SDK.
  if (result.provider === "general-vision-advisory" && (process.env.TRACEPOINT_DOCUMENT_VISION_PROVIDER ?? "").toLowerCase() === "bedrock") {
    const [{ configuredDocumentVisionAnalyzer, renderPdfPagesForAnalysis }, { configuredDocumentLayoutProvider }, { analyzeScannedPagesWithLayout }] = await Promise.all([import("./document-vision-runtime"), import("./document-layout-provider"), import("./scanned-analysis-enrichment")]);
    const general = configuredDocumentVisionAnalyzer();
    if (general) {
      const pages = await renderPdfPagesForAnalysis(bytes);
      result = { ...result, proposals: await analyzeScannedPagesWithLayout(pages, general, configuredDocumentLayoutProvider()) };
    }
  }
  // Visual findings are never pre-confirmed.
  return { ...result, proposals: result.proposals.map((proposal) => (proposal.kind === "structured_section" ? proposal : { ...proposal, matchStatus: proposal.suggestedSemanticKey ? "suggested" : "unmatched", classification: proposal.suggestedSemanticKey ? "review" : "unmapped", reviewRequired: true })) };
}
