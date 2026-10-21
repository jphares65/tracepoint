export type TracePointQrKind = "vehicle" | "equipment";

export function buildTracePointQrValue(kind: TracePointQrKind, id: string) {
  const normalizedId = id.trim();
  if (!normalizedId) throw new Error("A TracePoint record ID is required.");
  return `tracepoint://${kind}/${encodeURIComponent(normalizedId)}`;
}

// Inverse of buildTracePointQrValue: returns the kind and record ID a printed label encodes, or null for any other value.
export function parseTracePointQrValue(value: string): { kind: TracePointQrKind; id: string } | null {
  const match = /^tracepoint:\/\/(vehicle|equipment)\/([^/?#]+)\/?$/i.exec(value.trim());
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[2]).trim();
    return id ? { kind: match[1].toLowerCase() as TracePointQrKind, id } : null;
  } catch {
    return null;
  }
}
