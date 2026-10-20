import { NextResponse } from "next/server";
import { analyzeDocumentContext } from "@/lib/agency-documents/context-analysis";
import { requiredSelections } from "@/lib/agency-documents/field-values";
import { qualificationPickerItem, type QualificationPickerRow } from "@/lib/agency-documents/context-picker";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

function clean(value: string | null) { return value?.trim() ?? ""; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Search text is used inside a PostgREST-style filter; keep only characters that cannot change the filter's meaning. */
function safeSearch(value: string) { return value.replace(/[^a-z0-9 .'-]/gi, "").slice(0, 40); }

export async function GET(request: Request) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, ["generate_agency_documents", "manage_document_templates"])) return permissionDeniedResponse("Document-generation permission is required.");
  const { admin, departmentId } = access.context;
  const url = new URL(request.url), templateId = clean(url.searchParams.get("templateId")), kind = clean(url.searchParams.get("kind")), search = safeSearch(clean(url.searchParams.get("search"))), personId = clean(url.searchParams.get("personId"));
  if (!templateId) return NextResponse.json({ error: "A template is required." }, { status: 400 });
  const template = await admin.from("document_templates").select("current_version").eq("id", templateId).eq("department_id", departmentId).maybeSingle();
  if (template.error || !template.data) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  const version = await admin.from("document_template_versions").select("id").eq("department_id", departmentId).eq("template_id", templateId).eq("version_number", template.data.current_version).single();
  if (version.error) return NextResponse.json({ error: "Template could not be read." }, { status: 500 });
  const [fieldRows, bindingRows] = await Promise.all([
    admin.from("document_template_fields").select("field_type,canonical_key").eq("department_id", departmentId).eq("template_version_id", version.data.id),
    admin.from("document_template_structured_bindings").select("source_type,filters").eq("department_id", departmentId).eq("template_version_id", version.data.id),
  ]);
  if (fieldRows.error || bindingRows.error) return NextResponse.json({ error: "Template context could not be read." }, { status: 500 });
  const fields = (fieldRows.data ?? []) as Array<{ field_type: "tracepoint_data" | "manual" | "static_text" | "generated_date"; canonical_key: string | null }>;
  const selections = requiredSelections(fields.map((field) => ({ fieldType: field.field_type, canonicalKey: field.canonical_key })));
  const bindings = (bindingRows.data ?? []) as Array<{ source_type?: string; filters?: { reportYearMode?: string } | null }>;
  const analysis = {
    ...analyzeDocumentContext(fields.filter((field) => field.field_type === "tracepoint_data").map((field) => field.canonical_key)),
    requiresPerson: selections.person || bindings.some((binding) => binding.source_type === "qualification_history"),
    requiresFirearm: selections.firearm,
    requiresQualification: selections.qualification,
    requiresReportYear: selections.reportYear || bindings.some((binding) => binding.filters?.reportYearMode === "document"),
  };

  if (kind === "person") {
    let query = admin.from("department_memberships").select("user_id,badge_number,rank_title,profiles!inner(full_name,email)").eq("department_id", departmentId).eq("is_active", true).limit(50);
    if (search) query = query.or(`badge_number.ilike.%${search}%,profiles.full_name.ilike.%${search}%`);
    const rows = await query;
    if (rows.error) return NextResponse.json({ error: "Officers could not be loaded." }, { status: 500 });
    return NextResponse.json({ analysis, items: (rows.data ?? []).map((row: { user_id: string; badge_number?: string; rank_title?: string; profiles?: { full_name?: string } }) => ({ id: row.user_id, label: row.profiles?.full_name || "Unnamed member", detail: [row.rank_title, row.badge_number ? `#${row.badge_number}` : ""].filter(Boolean).join(" · ") })) });
  }
  if (kind === "firearm") {
    let query = admin.from("firearms").select("id,make,model,serial_number,caliber").eq("department_id", departmentId).is("archived_at", null).limit(50);
    if (search) query = query.or(`serial_number.ilike.%${search}%,make.ilike.%${search}%,model.ilike.%${search}%`);
    const rows = await query;
    if (rows.error) return NextResponse.json({ error: "Firearms could not be loaded." }, { status: 500 });
    return NextResponse.json({ analysis, items: (rows.data ?? []).map((row: { id: string; make?: string; model?: string; serial_number?: string; caliber?: string }) => ({ id: row.id, label: [row.make, row.model].filter(Boolean).join(" ") || "Firearm", detail: [row.serial_number ? `S/N ${row.serial_number}` : "", row.caliber].filter(Boolean).join(" · ") })) });
  }
  if (kind === "qualification") {
    if (!UUID.test(personId)) return NextResponse.json({ analysis, items: [] });
    const rows = await admin.from("qualification_results").select("id,qualification_date,score,passed,historical_course_name").eq("department_id", departmentId).eq("officer_user_id", personId).order("qualification_date", { ascending: false }).limit(50);
    if (rows.error) return NextResponse.json({ error: "Qualifications could not be loaded." }, { status: 500 });
    return NextResponse.json({ analysis, items: ((rows.data ?? []) as QualificationPickerRow[]).map(qualificationPickerItem) });
  }
  return NextResponse.json({ analysis });
}
