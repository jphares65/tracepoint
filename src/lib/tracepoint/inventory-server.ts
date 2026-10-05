import { NextResponse } from "next/server";
import { accessFailureResponse, hasAnyServerPermission, resolveServerAccess } from "@/lib/tracepoint/server-access";

export async function getInventoryServerContext() {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return { error: accessFailureResponse(resolved) } as const;
  const context = resolved.context;
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
