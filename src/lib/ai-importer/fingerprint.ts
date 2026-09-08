import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { ImportPayload, PreviewRow, PreviewSummary } from "./types.ts";
import type { MigrationWorkspaceState } from "./workspace-types.ts";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function workspaceDigest(workspaceId: string, state: MigrationWorkspaceState, plans: Array<{ domain: string; payload: ImportPayload; rows: PreviewRow[]; summary: PreviewSummary }>) {
  return createHash("sha256").update(stable({ workspaceId, state, plans })).digest("hex");
}

export function previewDigest(rows: PreviewRow[], summary: PreviewSummary) {
  return createHash("sha256").update(stable({ rows, summary })).digest("hex");
}

function secret() {
  const configured = process.env.TRACEPOINT_IMPORT_APPROVAL_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("Import approval signing is not configured.");
  return "tracepoint-local-development-approval-key";
}

export function approvalToken(payload: ImportPayload, digest: string, departmentId: string, actorId: string) {
  return createHmac("sha256", secret()).update(stable({ payload, digest, departmentId, actorId })).digest("hex");
}

export function verifyApprovalToken(token: string, payload: ImportPayload, digest: string, departmentId: string, actorId: string) {
  if (!/^[a-f0-9]{64}$/i.test(token)) return false;
  const expected = approvalToken(payload, digest, departmentId, actorId);
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(token, "hex"));
}

export function workspaceApprovalToken(workspaceId: string, state: MigrationWorkspaceState, digest: string, departmentId: string, actorId: string) {
  return createHmac("sha256", secret()).update(stable({ workspaceId, state, digest, departmentId, actorId })).digest("hex");
}

export function verifyWorkspaceApprovalToken(token: string, workspaceId: string, state: MigrationWorkspaceState, digest: string, departmentId: string, actorId: string) {
  if (!/^[a-f0-9]{64}$/i.test(token)) return false;
  const expected = workspaceApprovalToken(workspaceId, state, digest, departmentId, actorId);
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(token, "hex"));
}
