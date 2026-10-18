export const RANGE_WORKSPACE_MAX_BODY_BYTES = 128 * 1024;

type RangeWorkspaceRequestBody =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 | 415; error: string };

function rejected(status: 400 | 413 | 415, error: string): RangeWorkspaceRequestBody {
  return { ok: false, status, error };
}

function declaredLength(request: Request) {
  const value = request.headers.get("content-length");
  if (!value) return null;
  if (!/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}

/**
 * The WAF exception for Range Workspace is intentionally limited to a bounded
 * JSON request. Enforce the same bound while streaming so a missing or forged
 * Content-Length header cannot turn the route into an unbounded upload path.
 */
export async function parseRangeWorkspaceRequestBody(
  request: Request,
): Promise<RangeWorkspaceRequestBody> {
  const contentType = request.headers.get("content-type")?.trim() ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return rejected(415, "Range workspace requests must use application/json.");
  }

  const length = declaredLength(request);
  if (Number.isNaN(length)) {
    return rejected(400, "Range workspace request content length is invalid.");
  }
  if (length !== null && length > RANGE_WORKSPACE_MAX_BODY_BYTES) {
    return rejected(413, "Range workspace request exceeds the 128 KiB limit.");
  }

  const reader = request.body?.getReader();
  if (!reader) return rejected(400, "Range workspace request body is required.");

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > RANGE_WORKSPACE_MAX_BODY_BYTES) {
        await reader.cancel();
        return rejected(413, "Range workspace request exceeds the 128 KiB limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return rejected(400, "Range workspace request body must be valid JSON.");
  }
}
