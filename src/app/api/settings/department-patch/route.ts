import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { createObjectStore } from "@/lib/storage/object-store";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const EXTENSIONS: Record<string, "png" | "jpg" | "webp"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export async function POST(request: NextRequest) {
  const access = await resolveServerAccess();

  if (!access.ok) {
    return accessFailureResponse(access);
  }

  const context = access.context;

  if (
    !hasAnyServerPermission(context, [
      "administer_department",
    ])
  ) {
    return NextResponse.json(
      { error: "You do not have permission to update the department patch." },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "A patch image is required." },
      { status: 400 },
    );
  }

  const extension = EXTENSIONS[file.type];

  if (!extension) {
    return NextResponse.json(
      { error: "Use a PNG, JPG, or WEBP image for the department patch." },
      { status: 400 },
    );
  }

  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "Department patch images must be 5 MB or smaller." },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const objectStore = createObjectStore(context.admin);
  const upload = await objectStore.uploadDepartmentPatch({
    departmentId: context.departmentId,
    extension,
    bytes,
    contentType: file.type,
    timestamp: Date.now(),
  });

  if (upload.error) {
    return NextResponse.json(
      { error: upload.error.message },
      { status: 500 },
    );
  }
  const storagePath = upload.path;

  const patchUrl = objectStore.getDepartmentPatchPublicUrl(storagePath);

  const { error: updateError } = await context.admin
    .from("departments")
    .update({ patch_url: patchUrl })
    .eq("id", context.departmentId);

  if (updateError) {
    await objectStore.removeDepartmentPatch(storagePath);

    return NextResponse.json(
      { error: updateError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    patchUrl,
  });
}
