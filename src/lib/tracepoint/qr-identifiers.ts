export type TracePointQrKind = "vehicle" | "equipment";

export function buildTracePointQrValue(kind: TracePointQrKind, id: string) {
  const normalizedId = id.trim();
  if (!normalizedId) throw new Error("A TracePoint record ID is required.");
  return `tracepoint://${kind}/${encodeURIComponent(normalizedId)}`;
}

