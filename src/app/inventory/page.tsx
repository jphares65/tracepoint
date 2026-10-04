"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Plus, RefreshCw } from "lucide-react";
import TracePointShell from "@/app/components/TracePointShell";
import OutstandingCheckouts from "./OutstandingCheckouts";
import InventoryCheckoutForm from "./InventoryCheckoutForm";

type Item = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  tracking_mode: "pooled" | "consumable";
  unit_of_measure: string;
  sku: string | null;
  is_active: boolean;
};
type Location = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
};
type Balance = {
  id: string;
  inventory_item_id: string;
  inventory_location_id: string;
  on_hand_quantity: number | string;
  inventory_items: Item | null;
  inventory_locations: Location | null;
};
type ItemForm = {
  id?: string;
  name: string;
  category: string;
  description: string;
  trackingMode: "pooled" | "consumable";
  unitOfMeasure: string;
  sku: string;
  isActive: boolean;
};
type LocationForm = {
  id?: string;
  name: string;
  description: string;
  isActive: boolean;
};
type Action = "item" | "receive" | "transfer" | "more" | null;
const field =
  "mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white";
const blankItem: ItemForm = {
  name: "",
  category: "General",
  description: "",
  trackingMode: "pooled",
  unitOfMeasure: "each",
  sku: "",
  isActive: true,
};
const blankLocation: LocationForm = {
  name: "",
  description: "",
  isActive: true,
};
const movement = (transactionType: "receive" | "transfer") => ({
  transactionType,
  itemId: "",
  sourceLocationId: "",
  destinationLocationId: "",
  quantity: "",
  reason: "",
  reference: "",
});

export default function InventoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [locationId, setLocationId] = useState("");
  const [itemForm, setItemForm] = useState<ItemForm>(blankItem);
  const [locationForm, setLocationForm] = useState<LocationForm>(blankLocation);
  const [stockMovement, setStockMovement] = useState(movement("receive"));
  const [action, setAction] = useState<Action>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const activeLocations = useMemo(
    () => locations.filter((location) => location.is_active),
    [locations],
  );
  const visibleBalances = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return balances;
    return balances.filter((balance) =>
      [
        balance.inventory_items?.name,
        balance.inventory_items?.category,
        balance.inventory_locations?.name,
      ].some((value) => value?.toLowerCase().includes(search)),
    );
  }, [balances, query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const suffix = locationId
        ? `?locationId=${encodeURIComponent(locationId)}`
        : "";
      const [itemResponse, locationResponse, balanceResponse] =
        await Promise.all([
          fetch("/api/inventory/items", { cache: "no-store" }),
          fetch("/api/inventory/locations", { cache: "no-store" }),
          fetch(`/api/inventory/balances${suffix}`, { cache: "no-store" }),
        ]);
      if (!itemResponse.ok || !locationResponse.ok || !balanceResponse.ok)
        throw new Error("Inventory could not be loaded.");
      setItems((await itemResponse.json()).items ?? []);
      setLocations((await locationResponse.json()).locations ?? []);
      setBalances((await balanceResponse.json()).balances ?? []);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Inventory could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [locationId]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  async function submit(
    url: string,
    body: unknown,
    done: () => void,
    method = "POST",
  ) {
    setError("");
    setMessage("");
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error ?? "Request failed.");
      return;
    }
    done();
    setMessage("Saved.");
    await load();
  }
  const openMovement = (next: "receive" | "transfer") => {
    setStockMovement(movement(next));
    setAction(action === next ? null : next);
  };

  return (
    <TracePointShell activePage="Inventory">
      <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-400">
                Pooled stock
              </p>
              <h1 className="mt-1 text-2xl font-bold text-white">Inventory</h1>
              <p className="mt-1 text-sm text-slate-400">
                Manage quantity-based stock separately from assigned equipment.
              </p>
            </div>
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200"
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="sr-only" htmlFor="inventory-search">
              Search inventory
            </label>
            <input
              id="inventory-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search items, categories, or locations"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white sm:max-w-sm"
            />
            <div className="flex flex-wrap gap-2">
              <ActionButton
                active={action === "item"}
                onClick={() => {
                  setItemForm(blankItem);
                  setAction(action === "item" ? null : "item");
                }}
              >
                <Plus size={14} /> Add Item
              </ActionButton>
              <ActionButton
                active={action === "receive"}
                onClick={() => openMovement("receive")}
              >
                Receive Stock
              </ActionButton>
              <ActionButton
                active={action === "transfer"}
                onClick={() => openMovement("transfer")}
              >
                Move Stock
              </ActionButton>
              <ActionButton
                active={action === "more"}
                onClick={() => setAction(action === "more" ? null : "more")}
              >
                More
              </ActionButton>
            </div>
          </div>
        </section>
        {error ? <Notice error>{error}</Notice> : null}
        {message ? <Notice>{message}</Notice> : null}

        <section className="rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4">
            <div className="flex items-center gap-2">
              <Boxes size={17} className="text-blue-300" />
              <div>
                <h2 className="font-semibold text-white">Current inventory</h2>
                <p className="text-xs text-slate-400">
                  On-hand quantity by storage location
                </p>
              </div>
            </div>
            <select
              aria-label="Filter balances by location"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
            >
              <option value="">All locations</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                  {location.is_active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </div>
          <div className="divide-y divide-slate-800">
            {visibleBalances.map((balance) => (
              <article
                key={balance.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 p-4"
              >
                <div className="min-w-0">
                  <h3 className="truncate font-medium text-white">
                    {balance.inventory_items?.name}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {balance.inventory_locations?.name} ·{" "}
                    {balance.inventory_items?.category} ·{" "}
                    {balance.inventory_items?.tracking_mode}
                  </p>
                </div>
                <p className="self-center text-right text-sm font-semibold text-white">
                  {Number(balance.on_hand_quantity).toLocaleString()}{" "}
                  {balance.inventory_items?.unit_of_measure}
                </p>
              </article>
            ))}
            {!loading && !visibleBalances.length ? (
              <p className="p-8 text-center text-sm text-slate-500">
                No stock matches the current filters.
              </p>
            ) : null}
          </div>
        </section>

        {action ? (
          <section className="grid gap-4 lg:grid-cols-2">
            {action === "item" ? (
              <Panel
                title={
                  itemForm.id ? "Edit inventory item" : "Add inventory item"
                }
              >
                <form
                  className="grid gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit(
                      "/api/inventory/items",
                      itemForm,
                      () => {
                        setItemForm(blankItem);
                        setAction(null);
                      },
                      itemForm.id ? "PATCH" : "POST",
                    );
                  }}
                >
                  <Label text="Item name">
                    <input
                      className={field}
                      placeholder="Example: CR123 Batteries"
                      value={itemForm.name}
                      onChange={(event) =>
                        setItemForm({ ...itemForm, name: event.target.value })
                      }
                    />
                  </Label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Label text="Category">
                      <input
                        className={field}
                        placeholder="Example: Batteries"
                        value={itemForm.category}
                        onChange={(event) =>
                          setItemForm({
                            ...itemForm,
                            category: event.target.value,
                          })
                        }
                      />
                    </Label>
                    <Label text="Unit of measure">
                      <input
                        className={field}
                        placeholder="Example: each, box, case"
                        value={itemForm.unitOfMeasure}
                        onChange={(event) =>
                          setItemForm({
                            ...itemForm,
                            unitOfMeasure: event.target.value,
                          })
                        }
                      />
                    </Label>
                  </div>
                  <Label
                    text="Inventory type"
                    helper="Pooled stock is reusable. Consumable stock is used up as it is issued."
                  >
                    <select
                      className={field}
                      value={itemForm.trackingMode}
                      onChange={(event) =>
                        setItemForm({
                          ...itemForm,
                          trackingMode: event.target
                            .value as ItemForm["trackingMode"],
                        })
                      }
                    >
                      <option value="pooled">Pooled</option>
                      <option value="consumable">Consumable</option>
                    </select>
                  </Label>
                  <Label text="SKU / part number">
                    <input
                      className={field}
                      placeholder="Manufacturer or agency part number (optional)"
                      value={itemForm.sku}
                      onChange={(event) =>
                        setItemForm({ ...itemForm, sku: event.target.value })
                      }
                    />
                  </Label>
                  <Label text="Description">
                    <textarea
                      className={field}
                      placeholder="Additional identifying information (optional)"
                      value={itemForm.description}
                      onChange={(event) =>
                        setItemForm({
                          ...itemForm,
                          description: event.target.value,
                        })
                      }
                    />
                  </Label>
                  <label className="text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={itemForm.isActive}
                      onChange={(event) =>
                        setItemForm({
                          ...itemForm,
                          isActive: event.target.checked,
                        })
                      }
                    />{" "}
                    Active
                  </label>
                  <Submit label={itemForm.id ? "Save item" : "Add item"} />
                </form>
              </Panel>
            ) : null}
            {action === "receive" || action === "transfer" ? (
              <Panel
                title={action === "receive" ? "Receive stock" : "Move stock"}
              >
                <form
                  className="grid gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit(
                      "/api/inventory/transactions",
                      {
                        ...stockMovement,
                        quantity: Number(stockMovement.quantity),
                      },
                      () => {
                        setStockMovement(movement(action));
                        setAction(null);
                      },
                    );
                  }}
                >
                  <Label text="Item">
                    <select
                      className={field}
                      value={stockMovement.itemId}
                      onChange={(event) =>
                        setStockMovement({
                          ...stockMovement,
                          itemId: event.target.value,
                        })
                      }
                    >
                      <option value="">Choose an inventory item</option>
                      {items
                        .filter((item) => item.is_active)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </Label>
                  {action === "transfer" ? (
                    <LocationField
                      text="From"
                      helper="Current inventory location"
                      value={stockMovement.sourceLocationId}
                      locations={activeLocations}
                      onChange={(value) =>
                        setStockMovement({
                          ...stockMovement,
                          sourceLocationId: value,
                        })
                      }
                    />
                  ) : null}
                  <LocationField
                    text={action === "receive" ? "Store at" : "To"}
                    helper={
                      action === "receive"
                        ? "Choose where this stock will be kept"
                        : "Destination inventory location"
                    }
                    value={stockMovement.destinationLocationId}
                    locations={activeLocations}
                    onChange={(value) =>
                      setStockMovement({
                        ...stockMovement,
                        destinationLocationId: value,
                      })
                    }
                  />
                  <Label
                    text={
                      action === "receive"
                        ? "Quantity received"
                        : "Quantity to move"
                    }
                  >
                    <input
                      className={field}
                      type="number"
                      step="0.001"
                      value={stockMovement.quantity}
                      onChange={(event) =>
                        setStockMovement({
                          ...stockMovement,
                          quantity: event.target.value,
                        })
                      }
                    />
                  </Label>
                  <Label text="Reason">
                    <input
                      className={field}
                      placeholder={
                        action === "receive"
                          ? "Invoice, purchase order, grant, etc. (optional)"
                          : "Reason or reference (optional)"
                      }
                      value={stockMovement.reason}
                      onChange={(event) =>
                        setStockMovement({
                          ...stockMovement,
                          reason: event.target.value,
                        })
                      }
                    />
                  </Label>
                  <Submit
                    label={
                      action === "receive" ? "Receive stock" : "Move stock"
                    }
                  />
                </form>
              </Panel>
            ) : null}
            {action === "more" ? (
              <>
                <Panel
                  title={locationForm.id ? "Edit location" : "Manage locations"}
                >
                  <form
                    className="grid gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submit(
                        "/api/inventory/locations",
                        locationForm,
                        () => setLocationForm(blankLocation),
                        locationForm.id ? "PATCH" : "POST",
                      );
                    }}
                  >
                    <Label text="Location name">
                      <input
                        className={field}
                        placeholder="Example: Patrol Supply Room"
                        value={locationForm.name}
                        onChange={(event) =>
                          setLocationForm({
                            ...locationForm,
                            name: event.target.value,
                          })
                        }
                      />
                    </Label>
                    <Label text="Description">
                      <textarea
                        className={field}
                        placeholder="Additional location details (optional)"
                        value={locationForm.description}
                        onChange={(event) =>
                          setLocationForm({
                            ...locationForm,
                            description: event.target.value,
                          })
                        }
                      />
                    </Label>
                    <p className="text-xs text-slate-500">
                      Vehicle, room, and bin targets are reserved for a later
                      phase.
                    </p>
                    <label className="text-xs text-slate-400">
                      <input
                        type="checkbox"
                        checked={locationForm.isActive}
                        onChange={(event) =>
                          setLocationForm({
                            ...locationForm,
                            isActive: event.target.checked,
                          })
                        }
                      />{" "}
                      Active
                    </label>
                    <Submit
                      label={locationForm.id ? "Save location" : "Add location"}
                    />
                  </form>
                </Panel>
                <section className="grid gap-4 lg:col-span-2 lg:grid-cols-2">
                  <List
                    title="Items"
                    rows={items}
                    render={(item) => (
                      <>
                        <b>{item.name}</b>
                        <span>
                          {item.category} · {item.tracking_mode} ·{" "}
                          {item.unit_of_measure}
                          {item.is_active ? "" : " · inactive"}
                        </span>
                        <button
                          className="w-fit text-xs text-blue-300"
                          onClick={() => {
                            setItemForm({
                              id: item.id,
                              name: item.name,
                              category: item.category,
                              description: item.description ?? "",
                              trackingMode: item.tracking_mode,
                              unitOfMeasure: item.unit_of_measure,
                              sku: item.sku ?? "",
                              isActive: item.is_active,
                            });
                            setAction("item");
                          }}
                        >
                          Edit
                        </button>
                      </>
                    )}
                  />
                  <List
                    title="Locations"
                    rows={locations}
                    render={(location) => (
                      <>
                        <b>{location.name}</b>
                        <span>
                          {location.description || "No description"}
                          {location.is_active ? "" : " · inactive"}
                        </span>
                        <button
                          className="w-fit text-xs text-blue-300"
                          onClick={() =>
                            setLocationForm({
                              id: location.id,
                              name: location.name,
                              description: location.description ?? "",
                              isActive: location.is_active,
                            })
                          }
                        >
                          Edit
                        </button>
                      </>
                    )}
                  />
                </section>
              </>
            ) : null}
          </section>
        ) : null}
        <OutstandingCheckouts />
        <Panel title="Temporary checkout">
          <InventoryCheckoutForm
            items={items}
            locations={activeLocations}
            balances={balances}
            onSuccess={load}
          />
        </Panel>
      </main>
    </TracePointShell>
  );
}

function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <p
      className={`rounded-lg border p-3 text-sm ${error ? "border-red-900 bg-red-950/40 text-red-200" : "border-emerald-900 bg-emerald-950/40 text-emerald-200"}`}
    >
      {children}
    </p>
  );
}
function ActionButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${active ? "border-blue-500 bg-blue-600 text-white" : "border-slate-700 text-slate-200"}`}
    >
      {children}
    </button>
  );
}
function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="font-semibold text-white">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
function Label({
  text,
  helper,
  children,
}: {
  text: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs font-medium text-slate-300">
      {text}
      {helper ? (
        <span className="mt-1 block font-normal text-slate-500">{helper}</span>
      ) : null}
      {children}
    </label>
  );
}
function LocationField({
  text,
  helper,
  value,
  locations,
  onChange,
}: {
  text: string;
  helper: string;
  value: string;
  locations: Location[];
  onChange: (value: string) => void;
}) {
  return (
    <Label text={text} helper={helper}>
      <select
        className={field}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose a location</option>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>
    </Label>
  );
}
function Submit({ label }: { label: string }) {
  return (
    <button className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white">
      <Plus size={15} />
      {label}
    </button>
  );
}
function List<T extends { id: string }>({
  title,
  rows,
  render,
}: {
  title: string;
  rows: T[];
  render: (row: T) => React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40">
      <h2 className="border-b border-slate-800 p-4 font-semibold text-white">
        {title}
      </h2>
      <div className="divide-y divide-slate-800">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-col gap-1 p-3 text-sm text-white"
          >
            {render(row)}
          </div>
        ))}
        {!rows.length ? (
          <p className="p-4 text-sm text-slate-500">None configured.</p>
        ) : null}
      </div>
    </section>
  );
}
