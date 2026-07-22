"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  DollarSign,
  History,
  Loader2,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

import ArmorySectionShell from "@/app/components/ArmorySectionShell";
import TracePointShell from "@/app/components/TracePointShell";
import {
  EMPTY_AMMO_WORKSPACE,
  VERIFICATION_MODES,
  asMoney,
  asNonNegativeInteger,
  calculateNextVerificationDate,
  createAmmoId,
  getCurrentInventoryValue,
  getLastPhysicalCount,
  getLotsForType,
  getWeightedAverageCost,
  normalizeAmmoWorkspace,
  withLegacyAmmunitionProjection,
  type AmmoActivity,
  type AmmoActivityKind,
  type AmmoLot,
  type AmmoType,
  type AmmoWorkspaceV2,
  type VerificationMode,
} from "@/lib/tracepoint/ammunition-workspace";

type ViewId =
  | "overview"
  | "types"
  | "receive"
  | "action"
  | "count"
  | "history";

type TypeDraft = {
  name: string;
  caliber: string;
  category: string;
  purpose: string;
  unitLabel: string;
  reorderThreshold: string;
  verificationMode: VerificationMode;
  customIntervalDays: string;
  notes: string;
};

type LotDraft = {
  ammoTypeId: string;
  manufacturer: string;
  product: string;
  lotNumber: string;
  vendor: string;
  purchaseDate: string;
  invoiceNumber: string;
  quantityReceived: string;
  costPerRound: string;
  shippingCost: string;
  taxCost: string;
  totalCost: string;
  notes: string;
};

type ActionDraft = {
  ammoTypeId: string;
  lotId: string;
  kind: Exclude<AmmoActivityKind, "Type Created" | "Purchase Received" | "Physical Count">;
  quantity: string;
  reference: string;
  notes: string;
};

type CountDraft = {
  ammoTypeId: string;
  physicalQuantity: string;
  notes: string;
};

const today = new Date().toISOString().slice(0, 10);

const EMPTY_TYPE_DRAFT: TypeDraft = {
  name: "",
  caliber: "",
  category: "",
  purpose: "",
  unitLabel: "rounds",
  reorderThreshold: "",
  verificationMode: "After Range Season",
  customIntervalDays: "180",
  notes: "",
};

const EMPTY_LOT_DRAFT: LotDraft = {
  ammoTypeId: "",
  manufacturer: "",
  product: "",
  lotNumber: "",
  vendor: "",
  purchaseDate: today,
  invoiceNumber: "",
  quantityReceived: "",
  costPerRound: "",
  shippingCost: "",
  taxCost: "",
  totalCost: "",
  notes: "",
};

const EMPTY_ACTION_DRAFT: ActionDraft = {
  ammoTypeId: "",
  lotId: "",
  kind: "Range Issue",
  quantity: "",
  reference: "",
  notes: "",
};

const EMPTY_COUNT_DRAFT: CountDraft = {
  ammoTypeId: "",
  physicalQuantity: "",
  notes: "",
};

const ACTION_KINDS: ActionDraft["kind"][] = [
  "Range Issue",
  "Duty Issue",
  "Return",
  "Disposal",
  "Correction",
];

function readError(response: Response) {
  return response
    .json()
    .then((payload: { error?: string }) => payload.error ?? "Request failed.")
    .catch(() => "Request failed.");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatDate(value?: string) {
  if (!value) return "Not recorded";

  const date = value.includes("T")
    ? new Date(value)
    : new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function inputClass() {
  return "mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-blue-500";
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-600">{hint}</span> : null}
    </label>
  );
}

function StatCard({
  label,
  value,
  detail,
  tone = "slate",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "slate" | "blue" | "amber" | "emerald";
}) {
  const classes = {
    slate: "border-slate-800 bg-slate-950/70",
    blue: "border-blue-800/70 bg-blue-950/30",
    amber: "border-amber-800/70 bg-amber-950/30",
    emerald: "border-emerald-800/70 bg-emerald-950/30",
  };

  return (
    <div className={`rounded-2xl border p-4 ${classes[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

export default function ArmoryAmmunitionPage() {
  const [workspace, setWorkspace] =
    useState<AmmoWorkspaceV2>(EMPTY_AMMO_WORKSPACE);
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [typeDraft, setTypeDraft] = useState<TypeDraft>(EMPTY_TYPE_DRAFT);
  const [lotDraft, setLotDraft] = useState<LotDraft>(EMPTY_LOT_DRAFT);
  const [actionDraft, setActionDraft] =
    useState<ActionDraft>(EMPTY_ACTION_DRAFT);
  const [countDraft, setCountDraft] =
    useState<CountDraft>(EMPTY_COUNT_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeTypes = useMemo(
    () =>
      [...workspace.ammoTypes]
        .filter((item) => item.isActive)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [workspace.ammoTypes],
  );

  const lowStockTypes = useMemo(
    () =>
      activeTypes.filter(
        (item) =>
          item.reorderThreshold > 0 &&
          item.currentOnHand <= item.reorderThreshold,
      ),
    [activeTypes],
  );

  const totals = useMemo(() => {
    const rounds = activeTypes.reduce(
      (sum, item) => sum + item.currentOnHand,
      0,
    );
    const value = activeTypes.reduce(
      (sum, item) => sum + getCurrentInventoryValue(workspace, item.id),
      0,
    );
    const spend = workspace.lots.reduce(
      (sum, item) => sum + item.totalCost,
      0,
    );

    return {
      rounds,
      value,
      spend,
      types: activeTypes.length,
    };
  }, [activeTypes, workspace]);

  async function loadWorkspace() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/pilot/ammunition", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const payload = (await response.json()) as { workspace?: unknown };
      const normalized = normalizeAmmoWorkspace(payload.workspace);
      setWorkspace(normalized);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Ammunition inventory could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveWorkspace(
    nextWorkspace: AmmoWorkspaceV2,
    successMessage: string,
  ) {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const projected = withLegacyAmmunitionProjection(nextWorkspace);
      const response = await fetch("/api/pilot/ammunition", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: projected }),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setWorkspace(projected);
      setMessage(successMessage);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Ammunition inventory could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

  function addActivity(
    current: AmmoWorkspaceV2,
    activity: Omit<AmmoActivity, "id" | "createdAt">,
  ) {
    return {
      ...current,
      activity: [
        {
          ...activity,
          id: createAmmoId("ammo-activity"),
          createdAt: new Date().toISOString(),
        },
        ...current.activity,
      ],
    };
  }

  async function handleCreateType() {
    const name = typeDraft.name.trim();

    if (!name) {
      setError("Enter a name for the ammunition type.");
      return;
    }

    if (
      workspace.ammoTypes.some(
        (item) => item.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      setError("An ammunition type with that name already exists.");
      return;
    }

    const now = new Date().toISOString();
    const verificationMode = typeDraft.verificationMode;
    const customIntervalDays =
      verificationMode === "Custom Days"
        ? Math.max(1, asNonNegativeInteger(typeDraft.customIntervalDays) || 180)
        : null;

    const ammoType: AmmoType = {
      id: createAmmoId("ammo-type"),
      name,
      caliber: typeDraft.caliber.trim(),
      category: typeDraft.category.trim(),
      purpose: typeDraft.purpose.trim(),
      unitLabel: typeDraft.unitLabel.trim() || "rounds",
      currentOnHand: 0,
      reorderThreshold: asNonNegativeInteger(typeDraft.reorderThreshold),
      verificationMode,
      customIntervalDays,
      nextVerificationDate: calculateNextVerificationDate(
        verificationMode,
        customIntervalDays,
      ),
      notes: typeDraft.notes.trim(),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    const next = addActivity(
      {
        ...workspace,
        ammoTypes: [ammoType, ...workspace.ammoTypes],
      },
      {
        ammoTypeId: ammoType.id,
        lotId: null,
        kind: "Type Created",
        quantityChange: 0,
        quantityBefore: 0,
        quantityAfter: 0,
        reference: "",
        notes: `Created ${ammoType.name}.`,
        unitCost: null,
        totalCost: null,
      },
    );

    await saveWorkspace(next, `${ammoType.name} created.`);
    setTypeDraft({
      ...EMPTY_TYPE_DRAFT,
      verificationMode: workspace.settings.defaultVerificationMode,
      customIntervalDays: String(
        workspace.settings.defaultCustomIntervalDays,
      ),
    });
  }

  async function handleUpdateType(
    id: string,
    patch: Partial<AmmoType>,
    successMessage: string,
  ) {
    const next = {
      ...workspace,
      ammoTypes: workspace.ammoTypes.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    };

    await saveWorkspace(next, successMessage);
  }

  async function handleReceiveLot() {
    const ammoType = workspace.ammoTypes.find(
      (item) => item.id === lotDraft.ammoTypeId,
    );
    const quantity = asNonNegativeInteger(lotDraft.quantityReceived);

    if (!ammoType || quantity <= 0 || !lotDraft.lotNumber.trim()) {
      setError("Select an ammunition type and enter a lot number and quantity.");
      return;
    }

    const unitCost = asMoney(lotDraft.costPerRound);
    const shipping = asMoney(lotDraft.shippingCost);
    const tax = asMoney(lotDraft.taxCost);
    const calculatedTotal = quantity * unitCost + shipping + tax;
    const enteredTotal = asMoney(lotDraft.totalCost);
    const totalCost = enteredTotal > 0 ? enteredTotal : calculatedTotal;
    const effectiveUnitCost =
      unitCost > 0
        ? unitCost
        : quantity > 0
          ? Math.max(0, (totalCost - shipping - tax) / quantity)
          : 0;
    const now = new Date().toISOString();

    const lot: AmmoLot = {
      id: createAmmoId("ammo-lot"),
      ammoTypeId: ammoType.id,
      manufacturer: lotDraft.manufacturer.trim(),
      product: lotDraft.product.trim(),
      lotNumber: lotDraft.lotNumber.trim(),
      vendor: lotDraft.vendor.trim(),
      purchaseDate: lotDraft.purchaseDate,
      invoiceNumber: lotDraft.invoiceNumber.trim(),
      quantityReceived: quantity,
      quantityRemaining: quantity,
      costPerRound: effectiveUnitCost,
      shippingCost: shipping,
      taxCost: tax,
      totalCost,
      notes: lotDraft.notes.trim(),
      createdAt: now,
      updatedAt: now,
    };

    const before = ammoType.currentOnHand;
    const after = before + quantity;
    let next: AmmoWorkspaceV2 = {
      ...workspace,
      lots: [lot, ...workspace.lots],
      ammoTypes: workspace.ammoTypes.map((item) =>
        item.id === ammoType.id
          ? { ...item, currentOnHand: after, updatedAt: now }
          : item,
      ),
    };

    next = addActivity(next, {
      ammoTypeId: ammoType.id,
      lotId: lot.id,
      kind: "Purchase Received",
      quantityChange: quantity,
      quantityBefore: before,
      quantityAfter: after,
      reference: lot.invoiceNumber || lot.vendor,
      notes: `Received lot ${lot.lotNumber}. ${lot.notes}`.trim(),
      unitCost: effectiveUnitCost,
      totalCost,
    });

    await saveWorkspace(next, `${formatNumber(quantity)} ${ammoType.unitLabel} received.`);
    setLotDraft({ ...EMPTY_LOT_DRAFT, ammoTypeId: ammoType.id });
  }

  async function handleInventoryAction() {
    const ammoType = workspace.ammoTypes.find(
      (item) => item.id === actionDraft.ammoTypeId,
    );
    const quantity = asNonNegativeInteger(actionDraft.quantity);

    if (!ammoType || quantity <= 0) {
      setError("Select an ammunition type and enter a quantity.");
      return;
    }

    const positive = actionDraft.kind === "Return";
    const correctionPositive =
      actionDraft.kind === "Correction" &&
      actionDraft.quantity.trim().startsWith("+");
    const direction = positive || correctionPositive ? 1 : -1;
    const change = direction * quantity;
    const before = ammoType.currentOnHand;
    const rawAfter = before + change;
    const after = workspace.settings.allowNegativeInventory
      ? rawAfter
      : Math.max(0, rawAfter);

    if (!workspace.settings.allowNegativeInventory && rawAfter < 0) {
      setError("This action would reduce inventory below zero.");
      return;
    }

    const now = new Date().toISOString();
    let nextLots = workspace.lots;

    if (actionDraft.lotId) {
      nextLots = workspace.lots.map((lot) =>
        lot.id === actionDraft.lotId
          ? {
              ...lot,
              quantityRemaining: Math.max(
                0,
                lot.quantityRemaining + (after - before),
              ),
              updatedAt: now,
            }
          : lot,
      );
    }

    let next: AmmoWorkspaceV2 = {
      ...workspace,
      lots: nextLots,
      ammoTypes: workspace.ammoTypes.map((item) =>
        item.id === ammoType.id
          ? { ...item, currentOnHand: after, updatedAt: now }
          : item,
      ),
    };

    next = addActivity(next, {
      ammoTypeId: ammoType.id,
      lotId: actionDraft.lotId || null,
      kind: actionDraft.kind,
      quantityChange: after - before,
      quantityBefore: before,
      quantityAfter: after,
      reference: actionDraft.reference.trim(),
      notes: actionDraft.notes.trim(),
      unitCost: null,
      totalCost: null,
    });

    await saveWorkspace(next, `${actionDraft.kind} recorded.`);
    setActionDraft({ ...EMPTY_ACTION_DRAFT, ammoTypeId: ammoType.id });
  }

  async function handlePhysicalCount() {
    const ammoType = workspace.ammoTypes.find(
      (item) => item.id === countDraft.ammoTypeId,
    );
    const physical = asNonNegativeInteger(countDraft.physicalQuantity);

    if (!ammoType || countDraft.physicalQuantity.trim() === "") {
      setError("Select an ammunition type and enter the physical count.");
      return;
    }

    const expected = ammoType.currentOnHand;
    const variance = physical - expected;
    const now = new Date().toISOString();
    const nextVerificationDate = calculateNextVerificationDate(
      ammoType.verificationMode,
      ammoType.customIntervalDays,
    );

    let next: AmmoWorkspaceV2 = {
      ...workspace,
      ammoTypes: workspace.ammoTypes.map((item) =>
        item.id === ammoType.id
          ? {
              ...item,
              currentOnHand: physical,
              nextVerificationDate,
              updatedAt: now,
            }
          : item,
      ),
      reconciliations: [
        {
          id: createAmmoId("ammo-count"),
          ammoTypeId: ammoType.id,
          expectedQuantity: expected,
          physicalQuantity: physical,
          variance,
          notes: countDraft.notes.trim(),
          completedAt: now,
        },
        ...workspace.reconciliations,
      ],
    };

    next = addActivity(next, {
      ammoTypeId: ammoType.id,
      lotId: null,
      kind: "Physical Count",
      quantityChange: variance,
      quantityBefore: expected,
      quantityAfter: physical,
      reference: "Physical inventory",
      notes: countDraft.notes.trim(),
      unitCost: null,
      totalCost: null,
    });

    await saveWorkspace(next, `${ammoType.name} physical count confirmed.`);
    setCountDraft({ ...EMPTY_COUNT_DRAFT, ammoTypeId: ammoType.id });
  }

  async function handleSaveDefaults() {
    const next = {
      ...workspace,
      ammoTypes: workspace.ammoTypes.map((item) =>
        item.verificationMode === "Manual" &&
        item.currentOnHand === 0 &&
        workspace.activity.filter(
          (activity) => activity.ammoTypeId === item.id,
        ).length <= 1
          ? {
              ...item,
              verificationMode: workspace.settings.defaultVerificationMode,
              customIntervalDays:
                workspace.settings.defaultVerificationMode === "Custom Days"
                  ? workspace.settings.defaultCustomIntervalDays
                  : null,
            }
          : item,
      ),
    };

    await saveWorkspace(next, "Agency ammunition defaults saved.");
  }

  const selectedActionLots = actionDraft.ammoTypeId
    ? getLotsForType(workspace, actionDraft.ammoTypeId)
    : [];

  const views: Array<{
    id: ViewId;
    label: string;
    icon: React.ReactNode;
  }> = [
    { id: "overview", label: "Inventory", icon: <Boxes size={15} /> },
    { id: "types", label: "Types & Rules", icon: <Settings size={15} /> },
    { id: "receive", label: "Receive Lot", icon: <PackagePlus size={15} /> },
    { id: "action", label: "Record Use", icon: <SlidersHorizontal size={15} /> },
    { id: "count", label: "Physical Count", icon: <ClipboardCheck size={15} /> },
    { id: "history", label: "History", icon: <History size={15} /> },
  ];

  return (
    <TracePointShell activePage="Armory">
      <div className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-6 lg:p-8">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
          <ArmorySectionShell
            title="Ammunition"
            description="Standing inventory totals with configurable ammunition types, lot and cost history, physical counts, and agency-defined reorder alerts."
            actions={
              <button
                type="button"
                onClick={() => void loadWorkspace()}
                disabled={loading || saving}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-600 hover:text-white disabled:opacity-50"
              >
                <RefreshCw size={15} />
                Refresh
              </button>
            }
          />

          <div className="flex flex-wrap gap-2">
            {views.map((view) => (
              <button
                key={view.id}
                type="button"
                onClick={() => setActiveView(view.id)}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                  activeView === view.id
                    ? "border-blue-500/50 bg-blue-500/10 text-blue-200"
                    : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-white"
                }`}
              >
                {view.icon}
                {view.label}
              </button>
            ))}
          </div>

          {error ? (
            <div className="flex items-start gap-3 rounded-2xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <p>{error}</p>
            </div>
          ) : null}

          {message ? (
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-800 bg-emerald-950/35 p-4 text-sm text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <p>{message}</p>
            </div>
          ) : null}

          {loading ? (
            <div className="flex min-h-[360px] items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/60">
              <Loader2 className="h-8 w-8 animate-spin text-blue-300" />
            </div>
          ) : null}

          {!loading && activeView === "overview" ? (
            <>
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Configured Types"
                  value={formatNumber(totals.types)}
                  detail="Agency-defined ammunition inventories"
                />
                <StatCard
                  label="Standing Inventory"
                  value={formatNumber(totals.rounds)}
                  detail="Across all active ammunition types"
                  tone="blue"
                />
                <StatCard
                  label="Current Value"
                  value={formatMoney(totals.value)}
                  detail="Weighted historical acquisition cost"
                  tone="emerald"
                />
                <StatCard
                  label="Reorder Alerts"
                  value={formatNumber(lowStockTypes.length)}
                  detail="At or below the agency threshold"
                  tone={lowStockTypes.length > 0 ? "amber" : "slate"}
                />
              </section>

              {lowStockTypes.length > 0 ? (
                <section className="rounded-3xl border border-amber-700/60 bg-amber-950/25 p-5">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-300" />
                    <div>
                      <h3 className="font-bold text-amber-100">
                        Ammunition order required
                      </h3>
                      <p className="mt-1 text-sm text-amber-200/70">
                        These standing totals have reached or crossed the reorder point.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {lowStockTypes.map((item) => (
                          <span
                            key={item.id}
                            className="rounded-full border border-amber-700/60 bg-amber-950/50 px-3 py-1 text-xs font-semibold text-amber-100"
                          >
                            {item.name}: {formatNumber(item.currentOnHand)} /{" "}
                            {formatNumber(item.reorderThreshold)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/70">
                <div className="border-b border-slate-800 px-5 py-4">
                  <h3 className="font-bold text-white">Current Inventory</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    The standing total is authoritative. Lots support purchasing,
                    cost history, and traceability.
                  </p>
                </div>

                {activeTypes.length === 0 ? (
                  <div className="p-8 text-center">
                    <Boxes className="mx-auto h-10 w-10 text-slate-700" />
                    <p className="mt-3 font-semibold text-slate-300">
                      No ammunition types configured
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveView("types")}
                      className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
                    >
                      <Plus size={15} />
                      Add Ammunition Type
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-slate-950/70 text-xs uppercase tracking-[0.12em] text-slate-600">
                        <tr>
                          <th className="px-5 py-3">Ammunition</th>
                          <th className="px-5 py-3">On Hand</th>
                          <th className="px-5 py-3">Reorder At</th>
                          <th className="px-5 py-3">Avg. Cost</th>
                          <th className="px-5 py-3">Value</th>
                          <th className="px-5 py-3">Last Count</th>
                          <th className="px-5 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {activeTypes.map((item) => {
                          const low =
                            item.reorderThreshold > 0 &&
                            item.currentOnHand <= item.reorderThreshold;
                          const lastCount = getLastPhysicalCount(
                            workspace,
                            item.id,
                          );

                          return (
                            <tr key={item.id} className="hover:bg-slate-950/30">
                              <td className="px-5 py-4">
                                <p className="font-semibold text-white">
                                  {item.name}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {[item.caliber, item.category, item.purpose]
                                    .filter(Boolean)
                                    .join(" · ") || "Agency-defined type"}
                                </p>
                              </td>
                              <td className="px-5 py-4 font-bold text-white">
                                {formatNumber(item.currentOnHand)}{" "}
                                <span className="text-xs font-normal text-slate-600">
                                  {item.unitLabel}
                                </span>
                              </td>
                              <td className="px-5 py-4 text-slate-300">
                                {item.reorderThreshold > 0
                                  ? formatNumber(item.reorderThreshold)
                                  : "Not set"}
                              </td>
                              <td className="px-5 py-4 text-slate-300">
                                {formatMoney(
                                  getWeightedAverageCost(workspace, item.id),
                                )}
                              </td>
                              <td className="px-5 py-4 text-slate-300">
                                {formatMoney(
                                  getCurrentInventoryValue(workspace, item.id),
                                )}
                              </td>
                              <td className="px-5 py-4 text-slate-400">
                                {lastCount
                                  ? formatDate(lastCount.completedAt)
                                  : "Not counted"}
                              </td>
                              <td className="px-5 py-4">
                                <span
                                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                                    low
                                      ? "border-amber-700 bg-amber-950/40 text-amber-200"
                                      : "border-emerald-800 bg-emerald-950/30 text-emerald-300"
                                  }`}
                                >
                                  {low ? "Order" : "In Stock"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          ) : null}

          {!loading && activeView === "types" ? (
            <div className="grid gap-6 xl:grid-cols-[0.9fr_1.6fr]">
              <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
                <div className="flex items-center gap-3">
                  <Plus className="h-5 w-5 text-blue-300" />
                  <div>
                    <h3 className="font-bold text-white">Add Ammunition Type</h3>
                    <p className="text-sm text-slate-500">
                      Agencies may create as many distinct inventories as needed.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4">
                  <Field label="Type Name">
                    <input
                      value={typeDraft.name}
                      onChange={(event) =>
                        setTypeDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="9mm Training"
                      className={inputClass()}
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Caliber / Gauge">
                      <input
                        value={typeDraft.caliber}
                        onChange={(event) =>
                          setTypeDraft((current) => ({
                            ...current,
                            caliber: event.target.value,
                          }))
                        }
                        placeholder="9mm"
                        className={inputClass()}
                      />
                    </Field>
                    <Field label="Category">
                      <input
                        value={typeDraft.category}
                        onChange={(event) =>
                          setTypeDraft((current) => ({
                            ...current,
                            category: event.target.value,
                          }))
                        }
                        placeholder="Training, Duty, Less Lethal..."
                        className={inputClass()}
                      />
                    </Field>
                  </div>

                  <Field label="Purpose">
                    <input
                      value={typeDraft.purpose}
                      onChange={(event) =>
                        setTypeDraft((current) => ({
                          ...current,
                          purpose: event.target.value,
                        }))
                      }
                      placeholder="Qualification and range use"
                      className={inputClass()}
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Measurement Unit">
                      <input
                        value={typeDraft.unitLabel}
                        onChange={(event) =>
                          setTypeDraft((current) => ({
                            ...current,
                            unitLabel: event.target.value,
                          }))
                        }
                        placeholder="rounds"
                        className={inputClass()}
                      />
                    </Field>
                    <Field
                      label="Reorder Threshold"
                      hint="A notification becomes active at or below this quantity."
                    >
                      <input
                        inputMode="numeric"
                        value={typeDraft.reorderThreshold}
                        onChange={(event) =>
                          setTypeDraft((current) => ({
                            ...current,
                            reorderThreshold: event.target.value,
                          }))
                        }
                        placeholder="5000"
                        className={inputClass()}
                      />
                    </Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Verification Schedule">
                      <select
                        value={typeDraft.verificationMode}
                        onChange={(event) =>
                          setTypeDraft((current) => ({
                            ...current,
                            verificationMode: event.target
                              .value as VerificationMode,
                          }))
                        }
                        className={inputClass()}
                      >
                        {VERIFICATION_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {typeDraft.verificationMode === "Custom Days" ? (
                      <Field label="Interval in Days">
                        <input
                          inputMode="numeric"
                          value={typeDraft.customIntervalDays}
                          onChange={(event) =>
                            setTypeDraft((current) => ({
                              ...current,
                              customIntervalDays: event.target.value,
                            }))
                          }
                          className={inputClass()}
                        />
                      </Field>
                    ) : (
                      <div />
                    )}
                  </div>

                  <Field label="Notes">
                    <textarea
                      value={typeDraft.notes}
                      onChange={(event) =>
                        setTypeDraft((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      rows={3}
                      className={inputClass()}
                    />
                  </Field>

                  <button
                    type="button"
                    onClick={() => void handleCreateType()}
                    disabled={saving}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    Create Type
                  </button>
                </div>
              </section>

              <div className="space-y-6">
                <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
                  <div className="flex items-center gap-3">
                    <Settings className="h-5 w-5 text-blue-300" />
                    <div>
                      <h3 className="font-bold text-white">Agency Defaults</h3>
                      <p className="text-sm text-slate-500">
                        New ammunition types inherit these verification rules.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-3">
                    <Field label="Default Verification">
                      <select
                        value={workspace.settings.defaultVerificationMode}
                        onChange={(event) =>
                          setWorkspace((current) => ({
                            ...current,
                            settings: {
                              ...current.settings,
                              defaultVerificationMode: event.target
                                .value as VerificationMode,
                            },
                          }))
                        }
                        className={inputClass()}
                      >
                        {VERIFICATION_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Default Custom Days">
                      <input
                        inputMode="numeric"
                        value={workspace.settings.defaultCustomIntervalDays}
                        onChange={(event) =>
                          setWorkspace((current) => ({
                            ...current,
                            settings: {
                              ...current.settings,
                              defaultCustomIntervalDays: Math.max(
                                1,
                                asNonNegativeInteger(event.target.value) || 1,
                              ),
                            },
                          }))
                        }
                        className={inputClass()}
                      />
                    </Field>
                    <label className="mt-5 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={workspace.settings.allowNegativeInventory}
                        onChange={(event) =>
                          setWorkspace((current) => ({
                            ...current,
                            settings: {
                              ...current.settings,
                              allowNegativeInventory: event.target.checked,
                            },
                          }))
                        }
                      />
                      <span className="text-sm text-slate-300">
                        Allow negative inventory
                      </span>
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleSaveDefaults()}
                    disabled={saving}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white disabled:opacity-50"
                  >
                    <Save size={15} />
                    Save Agency Defaults
                  </button>
                </section>

                <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/70">
                  <div className="border-b border-slate-800 px-5 py-4">
                    <h3 className="font-bold text-white">Configured Types</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Reorder thresholds and verification schedules are set independently.
                    </p>
                  </div>

                  <div className="divide-y divide-slate-800">
                    {activeTypes.map((item) => (
                      <div key={item.id} className="grid gap-4 p-5 lg:grid-cols-[1fr_180px_210px_110px] lg:items-end">
                        <div>
                          <p className="font-semibold text-white">{item.name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {[item.caliber, item.category, item.purpose]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <Field label="Reorder At">
                          <input
                            type="number"
                            min={0}
                            defaultValue={item.reorderThreshold}
                            onBlur={(event) => {
                              const value = asNonNegativeInteger(event.target.value);
                              if (value !== item.reorderThreshold) {
                                void handleUpdateType(
                                  item.id,
                                  { reorderThreshold: value },
                                  `${item.name} reorder threshold updated.`,
                                );
                              }
                            }}
                            className={inputClass()}
                          />
                        </Field>
                        <Field label="Verification">
                          <select
                            value={item.verificationMode}
                            onChange={(event) => {
                              const mode = event.target.value as VerificationMode;
                              void handleUpdateType(
                                item.id,
                                {
                                  verificationMode: mode,
                                  customIntervalDays:
                                    mode === "Custom Days"
                                      ? item.customIntervalDays ?? 180
                                      : null,
                                  nextVerificationDate:
                                    calculateNextVerificationDate(
                                      mode,
                                      mode === "Custom Days"
                                        ? item.customIntervalDays ?? 180
                                        : null,
                                    ),
                                },
                                `${item.name} verification schedule updated.`,
                              );
                            }}
                            className={inputClass()}
                          >
                            {VERIFICATION_MODES.map((mode) => (
                              <option key={mode} value={mode}>
                                {mode}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <button
                          type="button"
                          onClick={() =>
                            void handleUpdateType(
                              item.id,
                              { isActive: false },
                              `${item.name} archived.`,
                            )
                          }
                          className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-400 hover:border-red-800 hover:text-red-300"
                        >
                          Archive
                        </button>
                      </div>
                    ))}

                    {activeTypes.length === 0 ? (
                      <p className="p-6 text-sm text-slate-500">
                        No ammunition types have been configured.
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
          ) : null}

          {!loading && activeView === "receive" ? (
            <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center gap-3">
                <PackagePlus className="h-5 w-5 text-emerald-300" />
                <div>
                  <h3 className="font-bold text-white">Receive Ammunition Lot</h3>
                  <p className="text-sm text-slate-500">
                    Receiving a lot increases the standing total and preserves the full purchase and cost record.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Ammunition Type">
                  <select
                    value={lotDraft.ammoTypeId}
                    onChange={(event) =>
                      setLotDraft((current) => ({
                        ...current,
                        ammoTypeId: event.target.value,
                      }))
                    }
                    className={inputClass()}
                  >
                    <option value="">Select type</option>
                    {activeTypes.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Manufacturer">
                  <input value={lotDraft.manufacturer} onChange={(event) => setLotDraft((current) => ({ ...current, manufacturer: event.target.value }))} className={inputClass()} />
                </Field>
                <Field label="Product / Load">
                  <input value={lotDraft.product} onChange={(event) => setLotDraft((current) => ({ ...current, product: event.target.value }))} className={inputClass()} />
                </Field>
                <Field label="Lot Number">
                  <input value={lotDraft.lotNumber} onChange={(event) => setLotDraft((current) => ({ ...current, lotNumber: event.target.value }))} className={inputClass()} />
                </Field>
                <Field label="Vendor">
                  <input value={lotDraft.vendor} onChange={(event) => setLotDraft((current) => ({ ...current, vendor: event.target.value }))} className={inputClass()} />
                </Field>
                <Field label="Purchase Date">
                  <input type="date" value={lotDraft.purchaseDate} onChange={(event) => setLotDraft((current) => ({ ...current, purchaseDate: event.target.value }))} className={inputClass()} />
                </Field>
                <Field label="Invoice / PO">
                  <input value={lotDraft.invoiceNumber} onChange={(event) => setLotDraft((current) => ({ ...current, invoiceNumber: event.target.value }))} className={inputClass()} />
                </Field>
                <Field label="Quantity Received">
                  <input inputMode="numeric" value={lotDraft.quantityReceived} onChange={(event) => setLotDraft((current) => ({ ...current, quantityReceived: event.target.value }))} className={inputClass()} />
                </Field>
                <Field label="Cost Per Round">
                  <input inputMode="decimal" value={lotDraft.costPerRound} onChange={(event) => setLotDraft((current) => ({ ...current, costPerRound: event.target.value }))} className={inputClass()} />
                </Field>
                <Field label="Shipping">
                  <input inputMode="decimal" value={lotDraft.shippingCost} onChange={(event) => setLotDraft((current) => ({ ...current, shippingCost: event.target.value }))} className={inputClass()} />
                </Field>
                <Field label="Tax">
                  <input inputMode="decimal" value={lotDraft.taxCost} onChange={(event) => setLotDraft((current) => ({ ...current, taxCost: event.target.value }))} className={inputClass()} />
                </Field>
                <Field label="Total Cost" hint="Optional; calculated from quantity, unit cost, shipping, and tax when blank.">
                  <input inputMode="decimal" value={lotDraft.totalCost} onChange={(event) => setLotDraft((current) => ({ ...current, totalCost: event.target.value }))} className={inputClass()} />
                </Field>
              </div>

              <Field label="Notes">
                <textarea value={lotDraft.notes} onChange={(event) => setLotDraft((current) => ({ ...current, notes: event.target.value }))} rows={3} className={inputClass()} />
              </Field>

              <button
                type="button"
                onClick={() => void handleReceiveLot()}
                disabled={saving}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <PackagePlus size={15} />}
                Receive Lot
              </button>
            </section>
          ) : null}

          {!loading && activeView === "action" ? (
            <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center gap-3">
                <SlidersHorizontal className="h-5 w-5 text-blue-300" />
                <div>
                  <h3 className="font-bold text-white">Record Inventory Activity</h3>
                  <p className="text-sm text-slate-500">
                    Users manage the standing total. TracePoint creates the historical transaction record automatically.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Ammunition Type">
                  <select
                    value={actionDraft.ammoTypeId}
                    onChange={(event) =>
                      setActionDraft((current) => ({
                        ...current,
                        ammoTypeId: event.target.value,
                        lotId: "",
                      }))
                    }
                    className={inputClass()}
                  >
                    <option value="">Select type</option>
                    {activeTypes.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {formatNumber(item.currentOnHand)} on hand
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Action">
                  <select
                    value={actionDraft.kind}
                    onChange={(event) =>
                      setActionDraft((current) => ({
                        ...current,
                        kind: event.target.value as ActionDraft["kind"],
                      }))
                    }
                    className={inputClass()}
                  >
                    {ACTION_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Quantity"
                  hint={
                    actionDraft.kind === "Correction"
                      ? "Prefix with + to increase; otherwise the correction decreases inventory."
                      : undefined
                  }
                >
                  <input
                    value={actionDraft.quantity}
                    onChange={(event) =>
                      setActionDraft((current) => ({
                        ...current,
                        quantity: event.target.value,
                      }))
                    }
                    className={inputClass()}
                  />
                </Field>
                <Field label="Lot (Optional)">
                  <select
                    value={actionDraft.lotId}
                    onChange={(event) =>
                      setActionDraft((current) => ({
                        ...current,
                        lotId: event.target.value,
                      }))
                    }
                    className={inputClass()}
                  >
                    <option value="">Standing total only</option>
                    {selectedActionLots.map((lot) => (
                      <option key={lot.id} value={lot.id}>
                        {lot.lotNumber} · {formatNumber(lot.quantityRemaining)} estimated remaining
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Reference">
                  <input
                    value={actionDraft.reference}
                    onChange={(event) =>
                      setActionDraft((current) => ({
                        ...current,
                        reference: event.target.value,
                      }))
                    }
                    placeholder="Range day, officer, case, or memo"
                    className={inputClass()}
                  />
                </Field>
                <Field label="Notes">
                  <input
                    value={actionDraft.notes}
                    onChange={(event) =>
                      setActionDraft((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    className={inputClass()}
                  />
                </Field>
              </div>

              <button
                type="button"
                onClick={() => void handleInventoryAction()}
                disabled={saving}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                Record Action
              </button>
            </section>
          ) : null}

          {!loading && activeView === "count" ? (
            <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center gap-3">
                <ClipboardCheck className="h-5 w-5 text-emerald-300" />
                <div>
                  <h3 className="font-bold text-white">Confirm Physical Inventory</h3>
                  <p className="text-sm text-slate-500">
                    The confirmed physical count becomes the new official standing total. The variance remains in history.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <Field label="Ammunition Type">
                  <select
                    value={countDraft.ammoTypeId}
                    onChange={(event) =>
                      setCountDraft((current) => ({
                        ...current,
                        ammoTypeId: event.target.value,
                      }))
                    }
                    className={inputClass()}
                  >
                    <option value="">Select type</option>
                    {activeTypes.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · expected {formatNumber(item.currentOnHand)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Physical Count">
                  <input
                    inputMode="numeric"
                    value={countDraft.physicalQuantity}
                    onChange={(event) =>
                      setCountDraft((current) => ({
                        ...current,
                        physicalQuantity: event.target.value,
                      }))
                    }
                    className={inputClass()}
                  />
                </Field>
                <Field label="Variance">
                  <div className="mt-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                    {(() => {
                      const selected = activeTypes.find(
                        (item) => item.id === countDraft.ammoTypeId,
                      );
                      if (!selected || countDraft.physicalQuantity.trim() === "") {
                        return "Calculated automatically";
                      }
                      const variance =
                        asNonNegativeInteger(countDraft.physicalQuantity) -
                        selected.currentOnHand;
                      return `${variance >= 0 ? "+" : ""}${formatNumber(variance)}`;
                    })()}
                  </div>
                </Field>
              </div>

              <Field label="Count Notes / Explanation">
                <textarea
                  value={countDraft.notes}
                  onChange={(event) =>
                    setCountDraft((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  rows={3}
                  className={inputClass()}
                />
              </Field>

              <button
                type="button"
                onClick={() => void handlePhysicalCount()}
                disabled={saving}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                Confirm Count
              </button>
            </section>
          ) : null}

          {!loading && activeView === "history" ? (
            <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
              <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/70">
                <div className="border-b border-slate-800 px-5 py-4">
                  <h3 className="font-bold text-white">Inventory History</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Immutable operational history generated by inventory actions.
                  </p>
                </div>
                <div className="max-h-[680px] divide-y divide-slate-800 overflow-y-auto">
                  {[...workspace.activity]
                    .sort(
                      (left, right) =>
                        new Date(right.createdAt).getTime() -
                        new Date(left.createdAt).getTime(),
                    )
                    .map((item) => {
                      const type = workspace.ammoTypes.find(
                        (candidate) => candidate.id === item.ammoTypeId,
                      );
                      return (
                        <div key={item.id} className="p-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-white">
                                {item.kind}
                              </p>
                              <p className="mt-1 text-sm text-slate-400">
                                {type?.name ?? "Unknown ammunition type"}
                              </p>
                            </div>
                            <div className="text-right">
                              <p
                                className={`font-bold ${
                                  item.quantityChange < 0
                                    ? "text-amber-300"
                                    : item.quantityChange > 0
                                      ? "text-emerald-300"
                                      : "text-slate-300"
                                }`}
                              >
                                {item.quantityChange > 0 ? "+" : ""}
                                {formatNumber(item.quantityChange)}
                              </p>
                              <p className="text-xs text-slate-600">
                                {formatDate(item.createdAt)}
                              </p>
                            </div>
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            {formatNumber(item.quantityBefore)} →{" "}
                            {formatNumber(item.quantityAfter)}
                            {item.reference ? ` · ${item.reference}` : ""}
                          </p>
                          {item.notes ? (
                            <p className="mt-2 text-sm text-slate-400">
                              {item.notes}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  {workspace.activity.length === 0 ? (
                    <p className="p-6 text-sm text-slate-500">
                      No inventory activity has been recorded.
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/70">
                <div className="border-b border-slate-800 px-5 py-4">
                  <h3 className="font-bold text-white">Purchase & Cost History</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Historical lots remain available for budgeting, invoices, and recall traceability.
                  </p>
                </div>
                <div className="max-h-[680px] divide-y divide-slate-800 overflow-y-auto">
                  {[...workspace.lots]
                    .sort(
                      (left, right) =>
                        new Date(right.purchaseDate).getTime() -
                        new Date(left.purchaseDate).getTime(),
                    )
                    .map((lot) => {
                      const type = workspace.ammoTypes.find(
                        (candidate) => candidate.id === lot.ammoTypeId,
                      );
                      return (
                        <div key={lot.id} className="p-5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-white">
                                {type?.name ?? "Unknown type"}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {[lot.manufacturer, lot.product, `Lot ${lot.lotNumber}`]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            </div>
                            <DollarSign className="h-5 w-5 text-emerald-300" />
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <p className="text-xs uppercase tracking-wider text-slate-600">Received</p>
                              <p className="mt-1 text-slate-300">{formatNumber(lot.quantityReceived)}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-wider text-slate-600">Total Cost</p>
                              <p className="mt-1 text-slate-300">{formatMoney(lot.totalCost)}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-wider text-slate-600">Cost / Round</p>
                              <p className="mt-1 text-slate-300">{formatMoney(lot.costPerRound)}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-wider text-slate-600">Purchase Date</p>
                              <p className="mt-1 text-slate-300">{formatDate(lot.purchaseDate)}</p>
                            </div>
                          </div>
                          {(lot.vendor || lot.invoiceNumber) ? (
                            <p className="mt-3 text-xs text-slate-500">
                              {[lot.vendor, lot.invoiceNumber]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  {workspace.lots.length === 0 ? (
                    <p className="p-6 text-sm text-slate-500">
                      No ammunition purchases have been recorded.
                    </p>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}

          {saving ? (
            <div className="fixed bottom-5 right-5 flex items-center gap-2 rounded-xl border border-blue-800 bg-slate-900 px-4 py-3 text-sm font-semibold text-blue-200 shadow-xl">
              <Loader2 size={16} className="animate-spin" />
              Saving ammunition inventory
            </div>
          ) : null}
        </div>
      </div>
    </TracePointShell>
  );
}
