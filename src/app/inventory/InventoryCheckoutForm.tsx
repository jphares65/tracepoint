"use client";

import { useEffect, useMemo, useState } from "react";
import {
  checkoutRecipientPayload,
  filterRecipientOptions,
  type RecipientOption,
} from "@/lib/inventory/recipient-picker";

type Item = {
  id: string;
  name: string;
  tracking_mode: "pooled" | "consumable";
  unit_of_measure: string;
};
type Location = { id: string; name: string };
type Balance = {
  inventory_item_id: string;
  inventory_location_id: string;
  on_hand_quantity: number | string;
};
type RecipientType = "officer" | "unit" | "vehicle";
type Form = {
  itemId: string;
  locationId: string;
  recipientType: RecipientType;
  recipient: string;
  quantity: string;
  dueAt: string;
  reason: string;
  reference: string;
};
const input =
  "rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white";

export default function InventoryCheckoutForm({
  items,
  locations,
  balances,
  onSuccess,
}: {
  items: Item[];
  locations: Location[];
  balances: Balance[];
  onSuccess: () => Promise<void>;
}) {
  const [form, setForm] = useState<Form>({
    itemId: "",
    locationId: "",
    recipientType: "officer",
    recipient: "",
    quantity: "",
    dueAt: "",
    reason: "",
    reference: "",
  });
  const [officers, setOfficers] = useState<RecipientOption[]>([]);
  const [vehicles, setVehicles] = useState<RecipientOption[]>([]);
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [recipientError, setRecipientError] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const available = useMemo(
    () =>
      Number(
        balances.find(
          (balance) =>
            balance.inventory_item_id === form.itemId &&
            balance.inventory_location_id === form.locationId,
        )?.on_hand_quantity ?? 0,
      ),
    [balances, form.itemId, form.locationId],
  );

  useEffect(() => {
    if (form.recipientType === "unit") return;
    const endpoint =
      form.recipientType === "officer"
        ? "/api/pilot/personnel"
        : "/api/fleet/vehicles";
    let cancelled = false;
    async function loadRecipients() {
      setRecipientLoading(true);
      setRecipientError("");
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(payload.error ?? "Recipients could not be loaded.");
        if (cancelled) return;
        if (form.recipientType === "officer") {
          setOfficers(
            (payload.personnel ?? [])
              .filter(
                (person: { isActive?: boolean }) => person.isActive !== false,
              )
              .map(
                (person: {
                  id: string;
                  displayName?: string;
                  fullName?: string;
                  badgeNumber?: string | null;
                  unitName?: string | null;
                }) => ({
                  id: person.id,
                  label:
                    person.displayName || person.fullName || "Unnamed officer",
                  detail:
                    [person.badgeNumber, person.unitName]
                      .filter(Boolean)
                      .join(" · ") || undefined,
                }),
              ),
          );
        } else {
          setVehicles(
            (payload.items ?? [])
              .filter(
                (vehicle: { status?: string }) => vehicle.status !== "Retired",
              )
              .map(
                (vehicle: {
                  id: string;
                  unit_number?: string;
                  make?: string | null;
                  model?: string | null;
                  license_plate?: string | null;
                }) => ({
                  id: vehicle.id,
                  label: vehicle.unit_number || "Unnamed vehicle",
                  detail:
                    [vehicle.make, vehicle.model, vehicle.license_plate]
                      .filter(Boolean)
                      .join(" · ") || undefined,
                }),
              ),
          );
        }
      } catch (cause) {
        if (!cancelled)
          setRecipientError(
            cause instanceof Error
              ? cause.message
              : "Recipients could not be loaded.",
          );
      } finally {
        if (!cancelled) setRecipientLoading(false);
      }
    }
    void Promise.resolve().then(loadRecipients);
    return () => {
      cancelled = true;
    };
  }, [form.recipientType]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setOk("");
    const quantity = Number(form.quantity);
    if (
      !form.itemId ||
      !form.locationId ||
      !form.recipient ||
      !quantity ||
      quantity > available
    ) {
      setError(
        quantity > available
          ? `Only ${available} available at this location.`
          : "Complete the required checkout fields.",
      );
      return;
    }
    const response = await fetch("/api/inventory/checkouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: form.itemId,
        locationId: form.locationId,
        recipientType: form.recipientType,
        ...checkoutRecipientPayload(form.recipientType, form.recipient),
        quantity,
        dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
        reason: form.reason,
        reference: form.reference,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error ?? "Checkout failed.");
      return;
    }
    setOk("Checkout recorded.");
    setForm({
      ...form,
      recipient: "",
      quantity: "",
      dueAt: "",
      reason: "",
      reference: "",
    });
    window.dispatchEvent(new Event("inventory-checkouts-changed"));
    await onSuccess();
  }

  const recipientOptions =
    form.recipientType === "officer" ? officers : vehicles;
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="font-semibold text-white">Temporary checkout</h2>
      <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-2">
        <select
          aria-label="Pooled item"
          className={input}
          value={form.itemId}
          onChange={(event) => setForm({ ...form, itemId: event.target.value })}
        >
          <option value="">Pooled item</option>
          {items
            .filter((item) => item.tracking_mode === "pooled")
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
        <select
          aria-label="Source location"
          className={input}
          value={form.locationId}
          onChange={(event) =>
            setForm({ ...form, locationId: event.target.value })
          }
        >
          <option value="">Source location</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-400 sm:col-span-2">
          Available: <b className="text-white">{available}</b>
        </p>
        <select
          aria-label="Recipient type"
          className={input}
          value={form.recipientType}
          onChange={(event) =>
            setForm({
              ...form,
              recipientType: event.target.value as RecipientType,
              recipient: "",
            })
          }
        >
          <option value="officer">Officer</option>
          <option value="unit">Unit</option>
          <option value="vehicle">Vehicle</option>
        </select>
        {form.recipientType === "unit" ? (
          <input
            aria-label="Recipient unit"
            className={input}
            placeholder="Search unit"
            value={form.recipient}
            onChange={(event) =>
              setForm({ ...form, recipient: event.target.value })
            }
          />
        ) : (
          <RecipientPicker
            key={form.recipientType}
            label={form.recipientType === "officer" ? "Officer" : "Vehicle"}
            options={recipientOptions}
            value={form.recipient}
            loading={recipientLoading}
            error={recipientError}
            onSelect={(recipient) => setForm({ ...form, recipient })}
          />
        )}
        <input
          aria-label="Checkout quantity"
          className={input}
          type="number"
          min="0.001"
          max={available}
          step="0.001"
          placeholder="Quantity"
          value={form.quantity}
          onChange={(event) =>
            setForm({ ...form, quantity: event.target.value })
          }
        />
        <input
          aria-label="Due date"
          className={input}
          type="datetime-local"
          value={form.dueAt}
          onChange={(event) => setForm({ ...form, dueAt: event.target.value })}
        />
        <input
          className={input}
          placeholder="Reason (optional)"
          value={form.reason}
          onChange={(event) => setForm({ ...form, reason: event.target.value })}
        />
        <input
          className={input}
          placeholder="Reference (optional)"
          value={form.reference}
          onChange={(event) =>
            setForm({ ...form, reference: event.target.value })
          }
        />
        <button className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white sm:col-span-2">
          Check out
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {ok ? <p className="mt-2 text-sm text-emerald-300">{ok}</p> : null}
    </section>
  );
}

function RecipientPicker({
  label,
  options,
  value,
  loading,
  error,
  onSelect,
}: {
  label: string;
  options: RecipientOption[];
  value: string;
  loading: boolean;
  error: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = useMemo(
    () => filterRecipientOptions(options, query),
    [options, query],
  );
  const selected = options.find((option) => option.id === value);
  const choose = (option: RecipientOption) => {
    onSelect(option.id);
    setQuery(option.label);
    setOpen(false);
  };
  return (
    <div className="relative">
      <label
        className="sr-only"
        htmlFor={`inventory-${label.toLowerCase()}-picker`}
      >
        {label}
      </label>
      <input
        id={`inventory-${label.toLowerCase()}-picker`}
        aria-label={`Search ${label}`}
        aria-autocomplete="list"
        aria-controls={`inventory-${label.toLowerCase()}-options`}
        aria-expanded={open}
        role="combobox"
        className={input + " w-full"}
        placeholder={`Search ${label.toLowerCase()}s`}
        value={selected && !open ? selected.label : query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
          if (value) onSelect("");
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) =>
              Math.min(index + 1, Math.max(matches.length - 1, 0)),
            );
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          }
          if (event.key === "Enter" && open && matches[activeIndex]) {
            event.preventDefault();
            choose(matches[activeIndex]);
          }
          if (event.key === "Escape") setOpen(false);
        }}
      />
      {open ? (
        <div
          id={`inventory-${label.toLowerCase()}-options`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 p-1 shadow-xl"
        >
          {loading ? (
            <p className="p-2 text-xs text-slate-400">
              Loading {label.toLowerCase()}s…
            </p>
          ) : error ? (
            <p role="alert" className="p-2 text-xs text-red-300">
              {error}
            </p>
          ) : matches.length ? (
            matches.map((option, index) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.id === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                className={`block w-full rounded-md px-2 py-2 text-left text-sm ${index === activeIndex ? "bg-slate-800 text-white" : "text-slate-200"}`}
              >
                <span className="block">{option.label}</span>
                {option.detail ? (
                  <span className="block text-xs text-slate-400">
                    {option.detail}
                  </span>
                ) : null}
              </button>
            ))
          ) : (
            <p className="p-2 text-xs text-slate-400">
              No {label.toLowerCase()}s found.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
