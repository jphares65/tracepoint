import { NextResponse } from "next/server";
import { accessFailureResponse, featureDisabledResponse, hasAnyServerPermission, hasServerFeature, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { MODULE_FEATURE } from "@/lib/tracepoint/module-catalog";

export async function getInventoryServerContext() {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return { error: accessFailureResponse(resolved) } as const;
  const context = resolved.context;
  if (!hasServerFeature(context, MODULE_FEATURE.INVENTORY)) {
    return { error: featureDisabledResponse("Inventory") } as const;
  }
  return {
    // The generated schema types are refreshed with the migration deployment;
    // keep this module independently buildable while Phase 1 is unreleased.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: context.db as any,
    departmentId: context.departmentId,
    user: context.user,
    canView: hasAnyServerPermission(context, ["view_inventory", "manage_inventory", "adjust_inventory"]),
    canManage: hasAnyServerPermission(context, ["manage_inventory"]),
    canAdjust: hasAnyServerPermission(context, ["adjust_inventory", "manage_inventory"]),
  } as const;
}

export function inventoryDenied(action: "view" | "manage" | "adjust") {
  return NextResponse.json({ error: `You do not have permission to ${action} inventory.` }, { status: 403 });
}

export function text(value: unknown, maximum = 500) { return typeof value === "string" ? value.trim().slice(0, maximum) : ""; }
export function nullableText(value: unknown, maximum = 500) { return text(value, maximum) || null; }
export function quantity(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.round(parsed * 1000) / 1000 : NaN; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// One request, one record (065). An absent key is accepted from pages loaded
// before this release; a malformed one is refused rather than ignored.
export function idempotencyKey(value: unknown): { ok: true; key: string | null } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, key: null };
  return typeof value === "string" && UUID.test(value.trim()) ? { ok: true, key: value.trim().toLowerCase() } : { ok: false };
}
export function invalidIdempotencyKey() {
  return NextResponse.json({ error: "The request key is invalid. Reload the page and try again." }, { status: 400 });
}
// 23505 from the 065 functions: the key already recorded a different request,
// and nothing was written by this one.
export function inventoryRpcFailure(error: { code?: string; message?: string }, conflictText: string) {
  if (error.code === "23505")
    return NextResponse.json({ error: "This request was already used for a different inventory action, so nothing was recorded. Reload and try again." }, { status: 409 });
  if (error.code === "42501") return NextResponse.json({ error: "You do not have permission to change this inventory." }, { status: 403 });
  const message = error.message ?? "The inventory action could not be recorded.";
  return NextResponse.json({ error: message }, { status: error.code === "22003" || message.includes(conflictText) ? 409 : 400 });
}
