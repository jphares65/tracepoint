import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

const BUCKET = "department-assets";
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
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

  const storagePath =
    `${context.departmentId}/patch-${Date.now()}.${extension}`;

  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await context.admin.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json(
      { error: uploadError.message },
      { status: 500 },
    );
  }

  const { data: publicUrlData } = context.admin.storage
    .from(BUCKET)
    .getPublicUrl(storagePath);

  const patchUrl = publicUrlData.publicUrl;

  const { error: updateError } = await context.admin
    .from("departments")
    .update({ patch_url: patchUrl })
    .eq("id", context.departmentId);

  if (updateError) {
    await context.admin.storage
      .from(BUCKET)
      .remove([storagePath]);

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