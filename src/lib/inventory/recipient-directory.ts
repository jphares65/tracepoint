import type { RecipientOption } from "./recipient-picker";

// Rows of public.inventory_recipient_directory() (056): every member and fleet
// vehicle of the caller's agency, with inactive members and retired vehicles
// flagged so an existing checkout keeps its holder's name (D-62, D-63).
export type RecipientDirectoryRow = {
  recipient_type: "officer" | "vehicle";
  recipient_id: string;
  label: string;
  detail: string | null;
  is_active: boolean;
};

type Db = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }> };

export async function loadRecipientDirectory(db: Db): Promise<{ rows: RecipientDirectoryRow[] } | { error: { message?: string; code?: string } }> {
  const { data, error } = await db.rpc("inventory_recipient_directory", {});
  if (error) return { error };
  return { rows: (Array.isArray(data) ? data : data ? [data] : []) as RecipientDirectoryRow[] };
}

// The checkout picker offers only holders the database will accept: active
// members and vehicles that are not retired.
export function recipientOptions(rows: RecipientDirectoryRow[]) {
  const options = (type: RecipientDirectoryRow["recipient_type"]): RecipientOption[] =>
    rows
      .filter((row) => row.recipient_type === type && row.is_active)
      .map((row) => ({ id: String(row.recipient_id), label: row.label, ...(row.detail ? { detail: row.detail } : {}) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  return { officers: options("officer"), vehicles: options("vehicle") };
}

type CheckoutRecipient = {
  recipient_type: string;
  recipient_user_id: string | null;
  recipient_unit: string | null;
  recipient_vehicle_id: string | null;
};

// The holder of a checkout as people know it; never an identifier.
export function checkoutRecipientLabel(checkout: CheckoutRecipient, rows: RecipientDirectoryRow[]) {
  if (checkout.recipient_type === "unit") return checkout.recipient_unit?.trim() || "Unnamed unit";
  const type = checkout.recipient_type === "vehicle" ? "vehicle" : "officer";
  const id = type === "vehicle" ? checkout.recipient_vehicle_id : checkout.recipient_user_id;
  const row = rows.find((candidate) => candidate.recipient_type === type && String(candidate.recipient_id) === String(id));
  if (!row) return type === "vehicle" ? "Unknown vehicle" : "Unknown member";
  if (type === "vehicle") return `${/^unit\b/i.test(row.label) ? row.label : `Unit ${row.label}`}${row.is_active ? "" : " (retired)"}`;
  return `${row.label}${row.is_active ? "" : " (inactive)"}`;
}

export const recipientTypeLabel: Record<string, string> = { officer: "Officer", unit: "Unit", vehicle: "Vehicle" };
