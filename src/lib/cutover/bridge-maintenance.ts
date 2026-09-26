const readMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function bridgeWriteFenceResponse(
  environment: Record<string, string | undefined>,
  method: string,
): Response | null {
  if ((environment.TRACEPOINT_RUNTIME_PROVIDER_MODE ?? "bridge") !== "bridge") return null;
  const setting = environment.TRACEPOINT_SOURCE_WRITE_FROZEN;
  if (setting === undefined || setting === "off") return null;
  if (setting !== "on") {
    return Response.json({ code: "maintenance_configuration_invalid" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (readMethods.has(method.toUpperCase())) return null;
  return Response.json({ code: "source_write_frozen" }, {
    status: 503,
    headers: { "Cache-Control": "no-store", "Retry-After": "60" },
  });
}
