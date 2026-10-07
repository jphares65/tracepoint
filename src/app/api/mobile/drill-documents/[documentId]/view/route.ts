import { NextResponse } from "next/server";
import { attachmentPathFromMetadata, createObjectStore } from "@/lib/storage/object-store";
import { accessFailureResponse, hasAnyServerPermission, hasServerFeature, resolveServerAccess } from "@/lib/tracepoint/server-access";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ documentId: string }> };
export async function GET(request: Request, context: Context) {
  const resolved = await resolveServerAccess(); if (!resolved.ok) return accessFailureResponse(resolved);
  if ((!hasServerFeature(resolved.context, "range_training") && !hasServerFeature(resolved.context, "qualifications")) || !hasAnyServerPermission(resolved.context, ["manage_range_days", "score_range_days", "manage_qualifications"])) return NextResponse.json({ error: "Drill document not found." }, { status: 404 });
  const { documentId } = await context.params; const { admin, departmentId } = resolved.context;
  const found = await admin.from("drill_documents").select("storage_path,original_filename").eq("id", documentId).eq("department_id", departmentId).maybeSingle();
  if (found.error) return NextResponse.json({ error: "Drill document could not be opened." }, { status: 500 });
  const path = attachmentPathFromMetadata(found.data?.storage_path, departmentId); if (!path) return NextResponse.json({ error: "Drill document not found." }, { status: 404 });
  const signed = await (await createObjectStore(admin, departmentId)).createAttachmentView(path); if (signed.error || !signed.signedUrl) return NextResponse.json({ error: "Drill document could not be opened." }, { status: 500 });
  // The app exchanges its bearer credential for a short-lived, tenant-bound URL.
  // It never receives a storage path or a reusable object key.
  return NextResponse.json({ url: signed.signedUrl }, { headers: { "Cache-Control": "no-store" } });
}
