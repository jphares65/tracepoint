import { NextResponse } from "next/server";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { attachmentPathFromMetadata, createObjectStore } from "@/lib/storage/object-store";

type RouteContext = { params: Promise<{ attachmentId: string }> };

export async function GET(_request: Request, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const { attachmentId } = await routeContext.params;
  const { admin, departmentId } = resolved.context;
  const row = await admin.from("attachments").select("storage_path,file_name")
    .eq("id", attachmentId).eq("department_id", departmentId).is("archived_at", null).maybeSingle();
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 500 });
  if (!row.data) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  const signed = await createObjectStore(admin).createAttachmentDownload(
    attachmentPathFromMetadata(row.data.storage_path),
    row.data.file_name,
  );
  if (signed.error || !signed.signedUrl) return NextResponse.json({ error: signed.error?.message ?? "Download could not be created." }, { status: 500 });
  return NextResponse.redirect(signed.signedUrl);
}
