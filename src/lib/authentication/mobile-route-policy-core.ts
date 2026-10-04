const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isDedicatedMobileApiPath(url: string) {
  try { return new URL(url).pathname.startsWith("/api/mobile/"); }
  catch { return false; }
}

export function mobileDepartmentSelection(value: string | null) {
  const selected = value?.trim() ?? "";
  return selected && !uuid.test(selected) ? { ok: false as const } : { ok: true as const, selected };
}
