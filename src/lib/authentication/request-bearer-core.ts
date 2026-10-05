const bearerPattern = /^Bearer ([A-Za-z0-9._~-]+)$/;

/** Accept exactly one bounded bearer credential; headers are never merged. */
export function parseUniqueBearerToken(value: string | null) {
  if (!value || value.length > 16_391 || value.includes(",")) return null;
  const match = bearerPattern.exec(value);
  return match?.[1] ?? null;
}
