import { NextResponse } from "next/server";

import { configuredSiteOrigin } from "@/lib/authentication/redirects";
import { previewDigest, verifyApprovalToken } from "@/lib/ai-importer/fingerprint";
import { explicitApprovalComplete } from "@/lib/ai-importer/approval";
import { executeApprovedImport } from "@/lib/ai-importer/server/execution";
import { loadImportReferenceData } from "@/lib/ai-importer/server/reference-data";
import { parseImportPayload, validateImport } from "@/lib/ai-importer/validation";
import { accessFailureResponse, hasServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasServerPermission(access.context, "administer_department")) return permissionDeniedResponse("Department administration permission is required to execute imports.");
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || !explicitApprovalComplete(body.approval)) return NextResponse.json({ error: "Explicit approval of the domain, mappings, validation, and final import action is required." }, { status: 400 });
    const payload = parseImportPayload(body.payload);
    const token = typeof body.approvalToken === "string" ? body.approvalToken : "";
    const approvedDigest = typeof body.previewDigest === "string" ? body.previewDigest : "";
    if (!verifyApprovalToken(token, payload, approvedDigest, access.context.departmentId, access.context.userId)) return NextResponse.json({ error: "This approval does not match the selected file and mappings. Validate the import again." }, { status: 409 });

    const reference = await loadImportReferenceData(access.context.admin, access.context.departmentId, payload.domain);
    const validated = validateImport(payload, reference);
    const currentDigest = previewDigest(validated.rows, validated.summary);
    if (currentDigest !== approvedDigest) return NextResponse.json({ error: "Agency records changed after the preview. Validate again before importing." }, { status: 409 });
    if (validated.mappingIssues.some((issue) => issue.severity === "error") || validated.summary.blocked > 0) return NextResponse.json({ error: "Blocked or conflicting rows cannot be imported. Resolve them and validate again." }, { status: 409 });

    const executionServices = process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native"
      ? {
          personnel: (await import("@/lib/ai-importer/server/cognito-personnel-writer"))
            .createCognitoPersonnelWriter(configuredSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL)),
        }
      : {};
    const result = await executeApprovedImport(
      access.context.admin,
      payload,
      access.context.departmentId,
      access.context.userId,
      validated.rows,
      {},
      executionServices,
    );
    return NextResponse.json({ ok: result.failed === 0, result }, { status: result.failed ? 207 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The approved import could not be executed." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
