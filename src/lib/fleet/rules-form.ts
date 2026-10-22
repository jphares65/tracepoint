// UX-RB2-2 (D-27): a comma-separated list typed into Fleet Rules. The text is
// kept as typed, so "fleet_manager, " can be followed by a second code; the
// saved value is the trimmed, de-duplicated list.
export function parseCodeList(text: string) {
  return [...new Set(text.split(",").map((part) => part.trim()).filter(Boolean))];
}

export function formatCodeList(codes: unknown) {
  return Array.isArray(codes) ? codes.filter((code) => typeof code === "string").join(", ") : "";
}

// UX-RB2-2 (D-28): rules that did not load are never shown as the agency's
// rules, and the defaults are never saved over them.
export type RulesLoad = { state: "loading" } | { state: "loaded" } | { state: "failed"; error: string };

export function canSaveRules(load: RulesLoad, saving: boolean) {
  return load.state === "loaded" && !saving;
}
