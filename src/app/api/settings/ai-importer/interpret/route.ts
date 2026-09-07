import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { inferImport } from "@/lib/ai-importer/provider";
import { MAX_IMPORT_FILE_BYTES, parseWorkbook } from "@/lib/ai-importer/workbook";
import { accessFailureResponse, hasServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasServerPermission(access.context, "administer_department")) return permissionDeniedResponse("Department administration permission is required to import records.");

  try {
    const form = await request.formData();
    const candidate = form.get("file");
    if (!candidate || typeof candidate === "string" || typeof candidate.arrayBuffer !== "function") return NextResponse.json({ error: "Choose a CSV, XLSX, or XLS file." }, { status: 400 });
    if (candidate.size > MAX_IMPORT_FILE_BYTES) return NextResponse.json({ error: `The file is larger than the ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB import limit.` }, { status: 413 });
    const bytes = new Uint8Array(await candidate.arrayBuffer());
    const sheets = parseWorkbook(bytes, candidate.name);
    const interpretation = await inferImport(sheets);
    return NextResponse.json({
      file: { name: candidate.name.slice(0, 250), size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), type: candidate.type || "application/octet-stream", sheetCount: sheets.length },
      sheets,
      interpretation,
      limits: { maxFileBytes: MAX_IMPORT_FILE_BYTES },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TracePoint could not interpret this spreadsheet.";
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
