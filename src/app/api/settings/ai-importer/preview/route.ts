import { NextResponse } from "next/server";

import { approvalToken, previewDigest } from "@/lib/ai-importer/fingerprint";
import { loadImportReferenceData } from "@/lib/ai-importer/server/reference-data";
import { IMPORT_FIELDS } from "@/lib/ai-importer/catalog";
import { parseImportPayload, validateImport } from "@/lib/ai-importer/validation";
import { accessFailureResponse, hasServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasServerPermission(access.context, "administer_department")) return permissionDeniedResponse("Department administration permission is required to validate imports.");
  try {
    const payload = parseImportPayload(await request.json());
    const reference = await loadImportReferenceData(access.context.admin, access.context.departmentId, payload.domain);
    const validated = validateImport(payload, reference);
    const digest = previewDigest(validated.rows, validated.summary);
    return NextResponse.json({
      domain: payload.domain,
      fields: IMPORT_FIELDS[payload.domain],
      ...validated,
      approvalToken: approvalToken(payload, digest, access.context.departmentId, access.context.userId),
      previewDigest: digest,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The import could not be validated." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
