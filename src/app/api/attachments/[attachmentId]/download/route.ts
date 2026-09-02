import { NextResponse } from "next/server";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { attachmentPathFromMetadata, createObjectStore } from "@/lib/storage/object-store";
import { createEvidenceReadRepository } from "@/lib/evidence/read-repository";

type RouteContext = { params: Promise<{ attachmentId: string }> };

export async function GET(_request: Request, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const { attachmentId } = await routeContext.params;
  const { admin, departmentId } = resolved.context;
  try {
  const row = await createEvidenceReadRepository(admin, departmentId).getAttachment(departmentId, attachmentId);
  if (!row) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  const storagePath = attachmentPathFromMetadata(
    row.storage_path,
    departmentId,
  );
  if (!storagePath) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }
  const signed = await createObjectStore(admin).createAttachmentDownload(
    storagePath,
    row.file_name,
  );
  if (signed.error || !signed.signedUrl) return NextResponse.json({ error: signed.error?.message ?? "Download could not be created." }, { status: 500 });
  return NextResponse.redirect(signed.signedUrl);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Download could not be created." }, { status: 500 }); }
}
