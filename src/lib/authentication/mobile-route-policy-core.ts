const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDedicatedMobileApiPath(url: string) {
  try { return new URL(url).pathname.startsWith("/api/mobile/"); }
  catch { return false; }
}

export function mobileDepartmentSelection(value: string | null) {
  const selected = value?.trim() ?? "";
  return selected && !uuid.test(selected) ? { ok: false as const } : { ok: true as const, selected };
}

export function mobileSupportSelection(selected: string, value: string | null) {
  const mode = value?.trim() ?? "";
  if (mode && mode !== "true" && mode !== "false") return { ok: false as const };
  if (mode === "true" && (!selected || !uuid.test(selected))) return { ok: false as const };
  return { ok: true as const, support: mode === "true" ? selected : "" };
}
