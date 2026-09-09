import { NextResponse } from "next/server";
import { attachmentPathFromMetadata, createObjectStore } from "@/lib/storage/object-store";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

type Context = { params: Promise<{ documentId: string; disposition: string }> };

export async function GET(_request: Request, routeContext: Context) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const { documentId, disposition } = await routeContext.params;
  if (disposition !== "view" && disposition !== "download") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const { admin, departmentId } = resolved.context;
  const row = await admin.from("drill_documents").select("storage_path,original_filename")
    .eq("id", documentId).eq("department_id", departmentId).maybeSingle();
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 500 });
  if (!row.data) return NextResponse.json({ error: "Drill document not found." }, { status: 404 });
  const path = attachmentPathFromMetadata(row.data.storage_path, departmentId);
  if (!path) return NextResponse.json({ error: "Drill document not found." }, { status: 404 });
  const store = createObjectStore(admin, departmentId);
  const signed = disposition === "download"
    ? await store.createAttachmentDownload(path, row.data.original_filename)
    : await store.createAttachmentView(path);
  if (signed.error || !signed.signedUrl) return NextResponse.json({ error: signed.error?.message ?? "Document could not be opened." }, { status: 500 });
  return NextResponse.redirect(signed.signedUrl);
}
