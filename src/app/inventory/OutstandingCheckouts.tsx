"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  returnPayload,
  validateReturnQuantity,
} from "@/lib/inventory/checkout-returns";

type Checkout = {
  id: string;
  inventory_item_id: string;
  inventory_location_id: string;
  recipient_type: string;
  recipient_user_id: string | null;
  recipient_unit: string | null;
  recipient_vehicle_id: string | null;
  quantity: number;
  checked_out_at: string;
  due_at: string | null;
  outstanding_quantity: number;
  overdue: boolean;
  inventory_checkout_returns: { quantity: number }[];
};
type Named = { id: string; name: string };

export default function OutstandingCheckouts({
  onReturnSuccess,
}: {
  onReturnSuccess?: () => Promise<void>;
}) {
  const [rows, setRows] = useState<Checkout[]>([]);
  const [items, setItems] = useState<Named[]>([]);
  const [locations, setLocations] = useState<Named[]>([]);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [checkouts, inventoryItems, inventoryLocations] = await Promise.all([
      fetch("/api/inventory/checkouts"),
      fetch("/api/inventory/items"),
      fetch("/api/inventory/locations"),
    ]);
    if (checkouts.ok) setRows((await checkouts.json()).checkouts ?? []);
    if (inventoryItems.ok) setItems((await inventoryItems.json()).items ?? []);
    if (inventoryLocations.ok)
      setLocations((await inventoryLocations.json()).locations ?? []);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
    window.addEventListener("inventory-checkouts-changed", load);
    return () =>
      window.removeEventListener("inventory-checkouts-changed", load);
  }, [load]);

  const itemNames = useMemo(
    () => new Map(items.map((item) => [item.id, item.name])),
    [items],
  );
  const locationNames = useMemo(
    () => new Map(locations.map((location) => [location.id, location.name])),
    [locations],
  );
  const activeCheckout = rows.find((row) => row.id === returningId) ?? null;

  function openReturn(checkout: Checkout) {
    setReturningId(checkout.id);
    setQuantity("");
    setNote("");
    setError("");
    setSuccess("");
  }

  async function submitReturn(
    event: React.FormEvent | React.MouseEvent,
    returnAll = false,
  ) {
    event.preventDefault();
    if (!activeCheckout || submitting) return;
    setError("");
    setSuccess("");
    const result = validateReturnQuantity(
      returnAll ? String(activeCheckout.outstanding_quantity) : quantity,
      Number(activeCheckout.outstanding_quantity),
    );
    if ("error" in result) {
      setError(result.error ?? "Invalid return quantity.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/inventory/checkouts/${activeCheckout.id}/returns`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(returnPayload(result.quantity, note)),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Return failed.");
        return;
      }
      setSuccess(returnAll ? "All stock returned." : "Return recorded.");
      setReturningId(null);
      setQuantity("");
      setNote("");
      setRows((currentRows) =>
        currentRows
          .map((checkout) =>
            checkout.id !== activeCheckout.id
              ? checkout
              : {
                  ...checkout,
                  outstanding_quantity:
                    Number(checkout.outstanding_quantity) - result.quantity,
                  inventory_checkout_returns: [
                    ...checkout.inventory_checkout_returns,
                    { quantity: result.quantity },
                  ],
                },
          )
          .filter((checkout) => checkout.outstanding_quantity > 0),
      );
      await Promise.all([load(), onReturnSuccess?.()]);
      window.dispatchEvent(new Event("inventory-checkouts-changed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 p-4">
        <h2 className="font-semibold text-white">Outstanding checkouts</h2>
      </div>
      {success ? (
        <p className="border-b border-emerald-900 bg-emerald-950/30 px-4 py-2 text-sm text-emerald-200">
          {success}
        </p>
      ) : null}
      <div className="divide-y divide-slate-800">
        {rows.map((checkout) => {
          const returned = checkout.inventory_checkout_returns.reduce(
            (total, row) => total + Number(row.quantity),
            0,
          );
          const recipient =
            checkout.recipient_unit ||
            checkout.recipient_user_id ||
            checkout.recipient_vehicle_id ||
            "Unknown";
          const isReturning = returningId === checkout.id;
          return (
            <article key={checkout.id} className="space-y-3 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">
                    {itemNames.get(checkout.inventory_item_id) ||
                      "Inventory item"}
                  </p>
                  <p className="text-slate-400">
                    {locationNames.get(checkout.inventory_location_id) ||
                      "Location"}{" "}
                    · {checkout.recipient_type}: {recipient}
                  </p>
                </div>
                <b
                  className={
                    checkout.overdue
                      ? "shrink-0 text-red-300"
                      : "shrink-0 text-blue-300"
                  }
                >
                  {checkout.outstanding_quantity} out
                </b>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                <span>Checked out: {Number(checkout.quantity)}</span>
                <span>Returned: {returned}</span>
                <span>Outstanding: {checkout.outstanding_quantity}</span>
                <span
                  className={
                    checkout.overdue ? "font-semibold text-red-300" : ""
                  }
                >
                  {checkout.due_at
                    ? `${checkout.overdue ? "Overdue" : "Due"}: ${new Date(checkout.due_at).toLocaleString()}`
                    : "No due date"}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Checkout: {new Date(checkout.checked_out_at).toLocaleString()}
              </p>
              {!isReturning ? (
                <button
                  onClick={() => openReturn(checkout)}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-100"
                >
                  Return
                </button>
              ) : (
                <form
                  onSubmit={submitReturn}
                  className="rounded-lg border border-slate-700 bg-slate-950/50 p-3"
                >
                  <div className="mb-3 text-xs text-slate-400">
                    <p className="font-medium text-white">
                      Return{" "}
                      {itemNames.get(checkout.inventory_item_id) ||
                        "inventory item"}
                    </p>
                    <p>
                      {checkout.recipient_type}: {recipient}
                    </p>
                    <p>
                      Checked out {checkout.quantity} · Returned {returned} ·
                      Outstanding {checkout.outstanding_quantity}
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <label className="text-xs font-medium text-slate-300">
                      Quantity to return
                      <input
                        aria-label="Quantity to return"
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                        type="number"
                        min="0.001"
                        max={checkout.outstanding_quantity}
                        step="0.001"
                        value={quantity}
                        onChange={(event) => setQuantity(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={(event) => void submitReturn(event, true)}
                      className="self-end rounded-lg border border-blue-500 px-3 py-2 text-xs font-semibold text-blue-200 disabled:opacity-50"
                    >
                      Return All
                    </button>
                  </div>
                  <label className="mt-2 block text-xs font-medium text-slate-300">
                    Reason / reference
                    <input
                      aria-label="Reason or reference"
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                      placeholder="Optional reason or reference"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </label>
                  {error ? (
                    <p role="alert" className="mt-2 text-xs text-red-300">
                      {error}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      disabled={submitting}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {submitting ? "Returning…" : "Record partial return"}
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => setReturningId(null)}
                      className="px-3 py-2 text-xs font-semibold text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </article>
          );
        })}
        {!rows.length ? (
          <p className="p-8 text-center text-sm text-slate-500">
            No inventory is currently checked out.
          </p>
        ) : null}
      </div>
    </section>
  );
}
