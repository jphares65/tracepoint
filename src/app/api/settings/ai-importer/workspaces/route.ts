/* eslint-disable @typescript-eslint/no-explicit-any -- Workspace tables are pending generated Supabase types until the additive migration is applied. */
import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { DeterministicInferenceProvider, inferImport } from "@/lib/ai-importer/provider";
import { MAX_IMPORT_FILE_BYTES, parseWorkbook } from "@/lib/ai-importer/workbook";
import { MAX_WORKSPACE_BYTES, MAX_WORKSPACE_FILES, MAX_WORKSPACE_ROWS, MAX_WORKSPACE_SOURCES, MAX_WORKSPACE_TOTAL_CHARACTERS, parseWorkspaceState } from "@/lib/ai-importer/server/workspace-state";
import { configuredProvider } from "@/lib/ai-importer/server/provider-factory";
import { inferWorkspace } from "@/lib/ai-importer/workspace-inference";
import type { MigrationWorkspaceState, WorkspaceSource } from "@/lib/ai-importer/workspace-types";
import { accessFailureResponse, hasServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasServerPermission(access.context, "administer_department")) return permissionDeniedResponse("Department administration permission is required to view migration workspaces.");
  const admin = access.context.admin as any;
  const result = await admin.from("ai_migration_workspaces").select("id,status,created_at,updated_at,completed_at,expires_at,file_count").eq("department_id", access.context.departmentId).in("status", ["draft", "ready", "partially_completed"]).order("updated_at", { ascending: false }).limit(20);
  if (result.error) return NextResponse.json({ error: "Migration workspaces could not be loaded." }, { status: 500 });
  return NextResponse.json({ workspaces: (result.data ?? []).map((row: any) => ({ id: row.id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at, expiresAt: row.expires_at, fileCount: row.file_count })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasServerPermission(access.context, "administer_department")) return permissionDeniedResponse("Department administration permission is required to create migration workspaces.");
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => typeof value !== "string" && typeof value.arrayBuffer === "function");
    if (!files.length || files.length > MAX_WORKSPACE_FILES) throw new Error(`Choose between 1 and ${MAX_WORKSPACE_FILES} CSV, XLS, or XLSX files.`);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_WORKSPACE_BYTES) return NextResponse.json({ error: `The batch is larger than the ${MAX_WORKSPACE_BYTES / 1024 / 1024} MB workspace limit.` }, { status: 413 });
    const pendingSources: Array<{ id: string; fileId: string; file: WorkspaceSource["file"]; sheet: ReturnType<typeof parseWorkbook>[number]; uploadedAt: string }> = [];
    const provider = configuredProvider();
    let totalRows = 0;
    let totalCharacters = 0;
    for (const file of files) {
      if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error(`${file.name} exceeds the ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB per-file limit.`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const fileId = randomUUID();
      const sheets = parseWorkbook(bytes, file.name);
      if (pendingSources.length + sheets.length > MAX_WORKSPACE_SOURCES) throw new Error(`The workspace exceeds the ${MAX_WORKSPACE_SOURCES} worksheet limit.`);
      totalCharacters += sheets.reduce((sum, sheet) => sum + sheet.matrix.reduce((matrixSum, row) => matrixSum + row.reduce((rowSum, cell) => rowSum + cell.length, 0), 0), 0);
      if (totalCharacters > MAX_WORKSPACE_TOTAL_CHARACTERS) throw new Error("The expanded workspace exceeds the safe structured-staging limit.");
      const metadata = { name: file.name.slice(0, 250), size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), type: file.type || "application/octet-stream", sheetCount: sheets.length };
      for (const sheet of sheets) {
        totalRows += sheet.rowCount;
        if (totalRows > MAX_WORKSPACE_ROWS) throw new Error(`The workspace exceeds the ${MAX_WORKSPACE_ROWS.toLocaleString()} source-row limit.`);
        pendingSources.push({ id: randomUUID(), fileId, file: metadata, sheet, uploadedAt: new Date(file.lastModified || Date.now()).toISOString() });
      }
    }
    const deterministic = new DeterministicInferenceProvider();
    const interpretations = await Promise.all(pendingSources.map((pending, index) => inferImport([pending.sheet], provider.hosted && index >= 8 ? deterministic : provider)));
    const sources: WorkspaceSource[] = pendingSources.map((pending, index) => {
      const interpretation = interpretations[index];
      const reviewMappings = interpretation.mappings.filter((mapping) => mapping.targetField && mapping.confidence === "Needs Review").length;
      const headerConfidence = reviewMappings ? "Needs Review" : interpretation.mappings.some((mapping) => mapping.confidence === "Medium") ? "Medium" : "High";
      return { id: pending.id, fileId: pending.fileId, file: pending.file, sheetName: pending.sheet.name, matrix: pending.sheet.matrix, domain: interpretation.domain, headerRow: interpretation.headerRow, mappings: interpretation.mappings, excluded: false, headerConfidence, uploadedAt: pending.uploadedAt };
    });
    const inference = await inferWorkspace(sources, provider);
    const state = parseWorkspaceState({ version: 1, sources, sharedMappings: [], remediations: [], mergeRules: [], inference } satisfies MigrationWorkspaceState);
    const admin = access.context.admin as any;
    const result = await admin.from("ai_migration_workspaces").insert({ department_id: access.context.departmentId, created_by_user_id: access.context.userId, updated_by_user_id: access.context.userId, status: "draft", state, file_count: files.length, source_row_count: totalRows }).select("id,status,created_at,updated_at,completed_at,expires_at").single();
    if (result.error || !result.data) throw new Error("Migration workspace could not be staged.");
    return NextResponse.json({ workspace: { id: result.data.id, status: result.data.status, state, createdAt: result.data.created_at, updatedAt: result.data.updated_at, completedAt: result.data.completed_at, expiresAt: result.data.expires_at } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Migration workspace could not be created." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
