"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Target,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";

type AmmoWorkspace = {
  dutyLots: DutyAmmoLot[];
  trainingLots: TrainingAmmoLot[];
  transactions: AmmoTransaction[];
};

type AmmoLotBase = {
  id: string;
  caliber: string;
  manufacturer: string;
  loadDescription: string;
  lotNumber: string;
  purchaseDate: string;
  quantityOnHand: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type DutyAmmoLot = AmmoLotBase & {
  replacementDueDate: string;
  recallFlag: boolean;
  issueHistory: DutyIssueRecord[];
};

type TrainingAmmoLot = AmmoLotBase & {
  costPerRound: number;
  lowStockThreshold: number;
  issuedToRangeDays: TrainingIssueRecord[];
};

type DutyIssueRecord = {
  id: string;
  officerName: string;
  quantity: number;
  issueDate: string;
  replacementDueDate: string;
  notes: string;
};

type TrainingIssueRecord = {
  id: string;
  rangeDayTitle: string;
  quantityIssued: number;
  quantityConsumed: number;
  quantityReturned: number;
  issueDate: string;
  notes: string;
};

type AmmoTransaction = {
  id: string;
  workspace: "Duty" | "Training";
  lotId: string;
  description: string;
  quantityChange: number;
  createdAt: string;
};

type ActiveWorkspace = "duty" | "training";

type DutyForm = {
  caliber: string;
  manufacturer: string;
  loadDescription: string;
  lotNumber: string;
  purchaseDate: string;
  quantityOnHand: string;
  replacementDueDate: string;
  recallFlag: boolean;
  notes: string;
};

type TrainingForm = {
  caliber: string;
  manufacturer: string;
  loadDescription: string;
  lotNumber: string;
  purchaseDate: string;
  quantityOnHand: string;
  costPerRound: string;
  lowStockThreshold: string;
  notes: string;
};

type DutyIssueForm = {
  lotId: string;
  officerName: string;
  quantity: string;
  issueDate: string;
  replacementDueDate: string;
  notes: string;
};

type TrainingIssueForm = {
  lotId: string;
  rangeDayTitle: string;
  quantityIssued: string;
  quantityConsumed: string;
  quantityReturned: string;
  issueDate: string;
  notes: string;
};

const today = new Date().toISOString().slice(0, 10);

const EMPTY_WORKSPACE: AmmoWorkspace = {
  dutyLots: [],
  trainingLots: [],
  transactions: [],
};

const EMPTY_DUTY_FORM: DutyForm = {
  caliber: "",
  manufacturer: "",
  loadDescription: "",
  lotNumber: "",
  purchaseDate: today,
  quantityOnHand: "",
  replacementDueDate: "",
  recallFlag: false,
  notes: "",
};

const EMPTY_TRAINING_FORM: TrainingForm = {
  caliber: "",
  manufacturer: "",
  loadDescription: "",
  lotNumber: "",
  purchaseDate: today,
  quantityOnHand: "",
  costPerRound: "",
  lowStockThreshold: "500",
  notes: "",
};

const EMPTY_DUTY_ISSUE_FORM: DutyIssueForm = {
  lotId: "",
  officerName: "",
  quantity: "",
  issueDate: today,
  replacementDueDate: "",
  notes: "",
};

const EMPTY_TRAINING_ISSUE_FORM: TrainingIssueForm = {
  lotId: "",
  rangeDayTitle: "",
  quantityIssued: "",
  quantityConsumed: "",
  quantityReturned: "",
  issueDate: today,
  notes: "",
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseQuantity(value: string) {
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseMoney(value: string) {
  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatDate(value: string) {
  if (!value) return "Not set";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return "Not set";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function readError(response: Response) {
  return response
    .json()
    .then((payload: { error?: string }) => payload.error ?? "Request failed.")
    .catch(() => "Request failed.");
}

function sortByCaliber<T extends AmmoLotBase>(lots: T[]) {
  return [...lots].sort((left, right) => {
    const caliber = left.caliber.localeCompare(right.caliber);

    if (caliber !== 0) return caliber;

    return left.manufacturer.localeCompare(right.manufacturer);
  });
}

export default function ArmoryAmmunitionPage() {
  const [workspace, setWorkspace] = useState<AmmoWorkspace>(EMPTY_WORKSPACE);
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace>("duty");
  const [dutyForm, setDutyForm] = useState<DutyForm>(EMPTY_DUTY_FORM);
  const [trainingForm, setTrainingForm] =
    useState<TrainingForm>(EMPTY_TRAINING_FORM);
  const [dutyIssueForm, setDutyIssueForm] =
    useState<DutyIssueForm>(EMPTY_DUTY_ISSUE_FORM);
  const [trainingIssueForm, setTrainingIssueForm] =
    useState<TrainingIssueForm>(EMPTY_TRAINING_ISSUE_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dutyLots = useMemo(
    () => sortByCaliber(workspace.dutyLots),
    [workspace.dutyLots],
  );

  const trainingLots = useMemo(
    () => sortByCaliber(workspace.trainingLots),
    [workspace.trainingLots],
  );

  const stats = useMemo(() => {
    const dutyOnHand = workspace.dutyLots.reduce(
      (total, lot) => total + lot.quantityOnHand,
      0,
    );
    const trainingOnHand = workspace.trainingLots.reduce(
      (total, lot) => total + lot.quantityOnHand,
      0,
    );
    const lowStockTrainingLots = workspace.trainingLots.filter(
      (lot) => lot.quantityOnHand <= lot.lowStockThreshold,
    ).length;
    const recalledDutyLots = workspace.dutyLots.filter(
      (lot) => lot.recallFlag,
    ).length;

    return {
      dutyOnHand,
      trainingOnHand,
      lowStockTrainingLots,
      recalledDutyLots,
      totalLots: workspace.dutyLots.length + workspace.trainingLots.length,
    };
  }, [workspace]);

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

      const payload = (await response.json()) as {
        workspace?: Partial<AmmoWorkspace>;
      };

      setWorkspace({
        dutyLots: Array.isArray(payload.workspace?.dutyLots)
          ? payload.workspace.dutyLots
          : [],
        trainingLots: Array.isArray(payload.workspace?.trainingLots)
          ? payload.workspace.trainingLots
          : [],
        transactions: Array.isArray(payload.workspace?.transactions)
          ? payload.workspace.transactions
          : [],
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Ammunition workspace could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveWorkspace(nextWorkspace: AmmoWorkspace, successMessage: string) {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/pilot/ammunition", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ workspace: nextWorkspace }),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setWorkspace(nextWorkspace);
      setMessage(successMessage);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Ammunition workspace could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

  function addTransaction(
    current: AmmoWorkspace,
    transaction: Omit<AmmoTransaction, "id" | "createdAt">,
  ): AmmoWorkspace {
    return {
      ...current,
      transactions: [
        {
          ...transaction,
          id: createId("ammo-transaction"),
          createdAt: new Date().toISOString(),
        },
        ...current.transactions,
      ].slice(0, 50),
    };
  }

  async function handleAddDutyLot() {
    const quantity = parseQuantity(dutyForm.quantityOnHand);

    if (
      !dutyForm.caliber.trim() ||
      !dutyForm.manufacturer.trim() ||
      !dutyForm.lotNumber.trim() ||
      quantity <= 0
    ) {
      setError("Duty ammunition requires caliber, manufacturer, lot number, and quantity.");
      return;
    }

    const now = new Date().toISOString();
    const lot: DutyAmmoLot = {
      id: createId("duty-ammo"),
      caliber: dutyForm.caliber.trim(),
      manufacturer: dutyForm.manufacturer.trim(),
      loadDescription: dutyForm.loadDescription.trim(),
      lotNumber: dutyForm.lotNumber.trim(),
      purchaseDate: dutyForm.purchaseDate,
      quantityOnHand: quantity,
      replacementDueDate: dutyForm.replacementDueDate,
      recallFlag: dutyForm.recallFlag,
      notes: dutyForm.notes.trim(),
      issueHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    const nextWorkspace = addTransaction(
      {
        ...workspace,
        dutyLots: [lot, ...workspace.dutyLots],
      },
      {
        workspace: "Duty",
        lotId: lot.id,
        description: `Added duty ammo lot ${lot.lotNumber}.`,
        quantityChange: quantity,
      },
    );

    await saveWorkspace(nextWorkspace, "Duty ammunition lot added.");
    setDutyForm(EMPTY_DUTY_FORM);
  }

  async function handleAddTrainingLot() {
    const quantity = parseQuantity(trainingForm.quantityOnHand);

    if (
      !trainingForm.caliber.trim() ||
      !trainingForm.manufacturer.trim() ||
      !trainingForm.lotNumber.trim() ||
      quantity <= 0
    ) {
      setError(
        "Training ammunition requires caliber, manufacturer, lot number, and quantity.",
      );
      return;
    }

    const now = new Date().toISOString();
    const lot: TrainingAmmoLot = {
      id: createId("training-ammo"),
      caliber: trainingForm.caliber.trim(),
      manufacturer: trainingForm.manufacturer.trim(),
      loadDescription: trainingForm.loadDescription.trim(),
      lotNumber: trainingForm.lotNumber.trim(),
      purchaseDate: trainingForm.purchaseDate,
      quantityOnHand: quantity,
      costPerRound: parseMoney(trainingForm.costPerRound),
      lowStockThreshold: parseQuantity(trainingForm.lowStockThreshold),
      notes: trainingForm.notes.trim(),
      issuedToRangeDays: [],
      createdAt: now,
      updatedAt: now,
    };

    const nextWorkspace = addTransaction(
      {
        ...workspace,
        trainingLots: [lot, ...workspace.trainingLots],
      },
      {
        workspace: "Training",
        lotId: lot.id,
        description: `Added training ammo lot ${lot.lotNumber}.`,
        quantityChange: quantity,
      },
    );

    await saveWorkspace(nextWorkspace, "Training ammunition lot added.");
    setTrainingForm(EMPTY_TRAINING_FORM);
  }

  async function handleIssueDutyAmmo() {
    const quantity = parseQuantity(dutyIssueForm.quantity);
    const lot = workspace.dutyLots.find((item) => item.id === dutyIssueForm.lotId);

    if (!lot || !dutyIssueForm.officerName.trim() || quantity <= 0) {
      setError("Select a duty lot, enter an officer, and enter a quantity.");
      return;
    }

    if (quantity > lot.quantityOnHand) {
      setError("Duty issue quantity cannot exceed quantity on hand.");
      return;
    }

    const issueRecord: DutyIssueRecord = {
      id: createId("duty-issue"),
      officerName: dutyIssueForm.officerName.trim(),
      quantity,
      issueDate: dutyIssueForm.issueDate,
      replacementDueDate: dutyIssueForm.replacementDueDate,
      notes: dutyIssueForm.notes.trim(),
    };

    const nextLots = workspace.dutyLots.map((item) =>
      item.id === lot.id
        ? {
            ...item,
            quantityOnHand: item.quantityOnHand - quantity,
            issueHistory: [issueRecord, ...item.issueHistory],
            updatedAt: new Date().toISOString(),
          }
        : item,
    );

    const nextWorkspace = addTransaction(
      {
        ...workspace,
        dutyLots: nextLots,
      },
      {
        workspace: "Duty",
        lotId: lot.id,
        description: `Issued ${quantity} round${quantity === 1 ? "" : "s"} to ${issueRecord.officerName}.`,
        quantityChange: -quantity,
      },
    );

    await saveWorkspace(nextWorkspace, "Duty ammunition issue recorded.");
    setDutyIssueForm(EMPTY_DUTY_ISSUE_FORM);
  }

  async function handleIssueTrainingAmmo() {
    const issued = parseQuantity(trainingIssueForm.quantityIssued);
    const consumed = parseQuantity(trainingIssueForm.quantityConsumed);
    const returned = parseQuantity(trainingIssueForm.quantityReturned);
    const netChange = issued - returned;
    const lot = workspace.trainingLots.find(
      (item) => item.id === trainingIssueForm.lotId,
    );

    if (!lot || !trainingIssueForm.rangeDayTitle.trim() || issued <= 0) {
      setError("Select a training lot, enter a range day, and enter quantity issued.");
      return;
    }

    if (returned > issued) {
      setError("Returned ammunition cannot exceed issued ammunition.");
      return;
    }

    if (consumed > issued) {
      setError("Consumed ammunition cannot exceed issued ammunition.");
      return;
    }

    if (netChange > lot.quantityOnHand) {
      setError("Training issue quantity cannot exceed quantity on hand.");
      return;
    }

    const issueRecord: TrainingIssueRecord = {
      id: createId("training-issue"),
      rangeDayTitle: trainingIssueForm.rangeDayTitle.trim(),
      quantityIssued: issued,
      quantityConsumed: consumed,
      quantityReturned: returned,
      issueDate: trainingIssueForm.issueDate,
      notes: trainingIssueForm.notes.trim(),
    };

    const nextLots = workspace.trainingLots.map((item) =>
      item.id === lot.id
        ? {
            ...item,
            quantityOnHand: item.quantityOnHand - netChange,
            issuedToRangeDays: [issueRecord, ...item.issuedToRangeDays],
            updatedAt: new Date().toISOString(),
          }
        : item,
    );

    const nextWorkspace = addTransaction(
      {
        ...workspace,
        trainingLots: nextLots,
      },
      {
        workspace: "Training",
        lotId: lot.id,
        description: `Issued ${issued} round${
          issued === 1 ? "" : "s"
        } to ${issueRecord.rangeDayTitle}; ${returned} returned.`,
        quantityChange: -netChange,
      },
    );

    await saveWorkspace(nextWorkspace, "Training ammunition issue recorded.");
    setTrainingIssueForm(EMPTY_TRAINING_ISSUE_FORM);
  }

  return (
    <TracePointShell activePage="Armory">
      <div className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-6 lg:p-8">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
          <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6 shadow-sm">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <Link
                  href="/firearms"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-slate-400 transition hover:text-white"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Firearms Inventory
                </Link>
                <p className="mt-5 text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
                  Armory / Ammunition
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">
                  Ammunition Management
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                  Pilot workspace for duty ammunition accountability and training
                  ammunition logistics. Duty ammo focuses on officer issue,
                  replacement, and recall tracking. Training ammo focuses on lots,
                  range-day usage, returns, consumption, and low-stock awareness.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void loadWorkspace()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
              >
                <RotateCcw className="h-4 w-4" />
                Refresh
              </button>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Ammo Lots
                </p>
                <p className="mt-2 text-3xl font-bold text-white">
                  {formatNumber(stats.totalLots)}
                </p>
              </div>
              <div className="rounded-2xl border border-blue-800 bg-blue-950/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">
                  Duty Rounds
                </p>
                <p className="mt-2 text-3xl font-bold text-blue-100">
                  {formatNumber(stats.dutyOnHand)}
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-800 bg-emerald-950/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
                  Training Rounds
                </p>
                <p className="mt-2 text-3xl font-bold text-emerald-100">
                  {formatNumber(stats.trainingOnHand)}
                </p>
              </div>
              <div className="rounded-2xl border border-amber-800 bg-amber-950/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
                  Low Stock
                </p>
                <p className="mt-2 text-3xl font-bold text-amber-100">
                  {formatNumber(stats.lowStockTrainingLots)}
                </p>
              </div>
              <div className="rounded-2xl border border-red-800 bg-red-950/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-200">
                  Recall Flags
                </p>
                <p className="mt-2 text-3xl font-bold text-red-100">
                  {formatNumber(stats.recalledDutyLots)}
                </p>
              </div>
            </div>
          </section>

          {(error || message) && (
            <section
              className={`rounded-2xl border p-4 text-sm font-medium ${
                error
                  ? "border-red-800 bg-red-950/40 text-red-200"
                  : "border-emerald-800 bg-emerald-950/40 text-emerald-200"
              }`}
            >
              {error ?? message}
            </section>
          )}

          <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-3 shadow-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setActiveWorkspace("duty")}
                className={`rounded-2xl px-4 py-3 text-left text-sm font-bold transition ${
                  activeWorkspace === "duty"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-950 text-slate-400 hover:bg-slate-800"
                }`}
              >
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  Duty Ammunition
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveWorkspace("training")}
                className={`rounded-2xl px-4 py-3 text-left text-sm font-bold transition ${
                  activeWorkspace === "training"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-950 text-slate-400 hover:bg-slate-800"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Training Ammunition
                </span>
              </button>
            </div>
          </section>

          {loading ? (
            <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-12 text-center text-slate-400">
              <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />
              Loading ammunition workspace...
            </section>
          ) : activeWorkspace === "duty" ? (
            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(420px,0.8fr)]">
              <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-blue-300" />
                  <h2 className="text-lg font-bold text-white">Duty Ammunition</h2>
                </div>
                <p className="mt-2 text-sm text-slate-400">
                  Accountability inventory for duty carry ammunition, replacement
                  cycles, recalls, and officer issue history.
                </p>

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  {dutyLots.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500 lg:col-span-2">
                      No duty ammunition lots have been added yet.
                    </div>
                  ) : (
                    dutyLots.map((lot) => (
                      <div
                        key={lot.id}
                        className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-lg font-bold text-white">
                              {lot.caliber} • {lot.manufacturer}
                            </p>
                            <p className="mt-1 text-sm text-slate-400">
                              {lot.loadDescription || "Duty ammunition"}
                            </p>
                          </div>
                          {lot.recallFlag ? (
                            <span className="rounded-full border border-red-700 bg-red-950/60 px-2.5 py-1 text-xs font-bold text-red-200">
                              Recall
                            </span>
                          ) : (
                            <span className="rounded-full border border-blue-700 bg-blue-950/60 px-2.5 py-1 text-xs font-bold text-blue-200">
                              Duty
                            </span>
                          )}
                        </div>

                        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                          <div>
                            <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              Lot
                            </dt>
                            <dd className="mt-1 font-mono text-slate-200">
                              {lot.lotNumber}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              On Hand
                            </dt>
                            <dd className="mt-1 text-xl font-bold text-white">
                              {formatNumber(lot.quantityOnHand)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              Purchased
                            </dt>
                            <dd className="mt-1 text-slate-200">
                              {formatDate(lot.purchaseDate)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              Replace By
                            </dt>
                            <dd className="mt-1 text-slate-200">
                              {formatDate(lot.replacementDueDate)}
                            </dd>
                          </div>
                        </dl>

                        {lot.issueHistory.length > 0 ? (
                          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                              Recent Issues
                            </p>
                            <div className="mt-2 space-y-2">
                              {lot.issueHistory.slice(0, 3).map((issue) => (
                                <div
                                  key={issue.id}
                                  className="text-xs leading-5 text-slate-300"
                                >
                                  <span className="font-semibold text-slate-100">
                                    {issue.officerName}
                                  </span>{" "}
                                  • {formatNumber(issue.quantity)} rounds •{" "}
                                  {formatDate(issue.issueDate)}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-6">
                <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5">
                  <div className="flex items-center gap-2">
                    <Plus className="h-5 w-5 text-blue-300" />
                    <h2 className="text-lg font-bold text-white">
                      Add Duty Lot
                    </h2>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <input
                      value={dutyForm.caliber}
                      onChange={(event) =>
                        setDutyForm((current) => ({
                          ...current,
                          caliber: event.target.value,
                        }))
                      }
                      placeholder="Caliber"
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
                    />
                    <input
                      value={dutyForm.manufacturer}
                      onChange={(event) =>
                        setDutyForm((current) => ({
                          ...current,
                          manufacturer: event.target.value,
                        }))
                      }
                      placeholder="Manufacturer"
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
                    />
                    <input
                      value={dutyForm.loadDescription}
                      onChange={(event) =>
                        setDutyForm((current) => ({
                          ...current,
                          loadDescription: event.target.value,
                        }))
                      }
                      placeholder="Load / round type"
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500 sm:col-span-2"
                    />
                    <input
                      value={dutyForm.lotNumber}
                      onChange={(event) =>
                        setDutyForm((current) => ({
                          ...current,
                          lotNumber: event.target.value,
                        }))
                      }
                      placeholder="Lot number"
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
                    />
                    <input
                      value={dutyForm.quantityOnHand}
                      onChange={(event) =>
                        setDutyForm((current) => ({
                          ...current,
                          quantityOnHand: event.target.value,
                        }))
                      }
                      placeholder="Quantity"
                      type="number"
                      min="0"
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
                    />
                    <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Purchase Date
                      <input
                        value={dutyForm.purchaseDate}
                        onChange={(event) =>
                          setDutyForm((current) => ({
                            ...current,
                            purchaseDate: event.target.value,
                          }))
                        }
                        type="date"
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-blue-500"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Replacement Due
                      <input
                        value={dutyForm.replacementDueDate}
                        onChange={(event) =>
                          setDutyForm((current) => ({
                            ...current,
                            replacementDueDate: event.target.value,
                          }))
                        }
                        type="date"
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-blue-500"
                      />
                    </label>
                    <label className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-300 sm:col-span-2">
                      <input
                        checked={dutyForm.recallFlag}
                        onChange={(event) =>
                          setDutyForm((current) => ({
                            ...current,
                            recallFlag: event.target.checked,
                          }))
                        }
                        type="checkbox"
                        className="h-4 w-4"
                      />
                      Mark lot as recall/hold
                    </label>
                    <textarea
                      value={dutyForm.notes}
                      onChange={(event) =>
                        setDutyForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="Notes"
                      rows={3}
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500 sm:col-span-2"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleAddDutyLot()}
                    disabled={saving}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save Duty Lot
                  </button>
                </div>

                <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5">
                  <div className="flex items-center gap-2">
                    <BadgeCheck className="h-5 w-5 text-blue-300" />
                    <h2 className="text-lg font-bold text-white">
                      Issue Duty Ammo
                    </h2>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <select
                      value={dutyIssueForm.lotId}
                      onChange={(event) =>
                        setDutyIssueForm((current) => ({
                          ...current,
                          lotId: event.target.value,
                        }))
                      }
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
                    >
                      <option value="">Select duty lot...</option>
                      {dutyLots.map((lot) => (
                        <option key={lot.id} value={lot.id}>
                          {lot.caliber} • {lot.manufacturer} • {lot.lotNumber} •{" "}
                          {formatNumber(lot.quantityOnHand)} on hand
                        </option>
                      ))}
                    </select>
                    <input
                      value={dutyIssueForm.officerName}
                      onChange={(event) =>
                        setDutyIssueForm((current) => ({
                          ...current,
                          officerName: event.target.value,
                        }))
                      }
                      placeholder="Officer name"
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
                    />
                    <input
                      value={dutyIssueForm.quantity}
                      onChange={(event) =>
                        setDutyIssueForm((current) => ({
                          ...current,
                          quantity: event.target.value,
                        }))
                      }
                      placeholder="Quantity issued"
                      type="number"
                      min="0"
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
                    />
                    <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Issue Date
                      <input
                        value={dutyIssueForm.issueDate}
                        onChange={(event) =>
                          setDutyIssueForm((current) => ({
                            ...current,
                            issueDate: event.target.value,
                          }))
                        }
                        type="date"
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-blue-500"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Replacement Due
                      <input
                        value={dutyIssueForm.replacementDueDate}
                        onChange={(event) =>
                          setDutyIssueForm((current) => ({
                            ...current,
                            replacementDueDate: event.target.value,
                          }))
                        }
                        type="date"
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-blue-500"
                      />
                    </label>
                    <textarea
                      value={dutyIssueForm.notes}
                      onChange={(event) =>
                        setDutyIssueForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="Issue notes"
                      rows={3}
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleIssueDutyAmmo()}
                    disabled={saving}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-500 px-4 py-2 text-sm font-bold text-blue-950 transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ClipboardList className="h-4 w-4" />
                    )}
                    Record Duty Issue
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(420px,0.8fr)]">
              <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5">
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-emerald-300" />
                  <h2 className="text-lg font-bold text-white">
                    Training Ammunition
                  </h2>
                </div>
                <p className="mt-2 text-sm text-slate-400">
                  Logistics inventory for training ammunition, range-day issue,
                  consumption, returns, and low-stock visibility.
                </p>

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  {trainingLots.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500 lg:col-span-2">
                      No training ammunition lots have been added yet.
                    </div>
                  ) : (
                    trainingLots.map((lot) => {
                      const lowStock = lot.quantityOnHand <= lot.lowStockThreshold;

                      return (
                        <div
                          key={lot.id}
                          className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-lg font-bold text-white">
                                {lot.caliber} • {lot.manufacturer}
                              </p>
                              <p className="mt-1 text-sm text-slate-400">
                                {lot.loadDescription || "Training ammunition"}
                              </p>
                            </div>
                            {lowStock ? (
                              <span className="rounded-full border border-amber-700 bg-amber-950/60 px-2.5 py-1 text-xs font-bold text-amber-200">
                                Low Stock
                              </span>
                            ) : (
                              <span className="rounded-full border border-emerald-700 bg-emerald-950/60 px-2.5 py-1 text-xs font-bold text-emerald-200">
                                Training
                              </span>
                            )}
                          </div>

                          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                            <div>
                              <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">
                                Lot
                              </dt>
                              <dd className="mt-1 font-mono text-slate-200">
                                {lot.lotNumber}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">
                                On Hand
                              </dt>
                              <dd className="mt-1 text-xl font-bold text-white">
                                {formatNumber(lot.quantityOnHand)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">
                                Cost / Round
                              </dt>
                              <dd className="mt-1 text-slate-200">
                                ${lot.costPerRound.toFixed(2)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">
                                Low Threshold
                              </dt>
                              <dd className="mt-1 text-slate-200">
                                {formatNumber(lot.lowStockThreshold)}
                              </dd>
                            </div>
                          </dl>

                          {lot.issuedToRangeDays.length > 0 ? (
                            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                                Recent Range Usage
                              </p>
                              <div className="mt-2 space-y-2">
                                {lot.issuedToRangeDays.slice(0, 3).map((issue) => (
                                  <div
                                    key={issue.id}
                                    className="text-xs leading-5 text-slate-300"
                                  >
                                    <span className="font-semibold text-slate-100">
                                      {issue.rangeDayTitle}
                                    </span>{" "}
                                    • issued {formatNumber(issue.quantityIssued)} •
                                    consumed {formatNumber(issue.quantityConsumed)}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-6">
                <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5">
                  <div className="flex items-center gap-2">
                    <Plus className="h-5 w-5 text-emerald-300" />
                    <h2 className="text-lg font-bold text-white">
                      Add Training Lot
                    </h2>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <input
                      value={trainingForm.caliber}
                      onChange={(event) =>
                        setTrainingForm((current) => ({
                          ...current,
                          caliber: event.target.value,
                        }))
                      }
                      placeholder="Caliber"
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
                    />
                    <input
                      value={trainingForm.manufacturer}
                      onChange={(event) =>
                        setTrainingForm((current) => ({
                          ...current,
                          manufacturer: event.target.value,
                        }))
                      }
                      placeholder="Manufacturer"
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
                    />
                    <input
                      value={trainingForm.loadDescription}
                      onChange={(event) =>
                        setTrainingForm((current) => ({
                          ...current,
                          loadDescription: event.target.value,
                        }))
                      }
                      placeholder="Load / round type"
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500 sm:col-span-2"
                    />
                    <input
                      value={trainingForm.lotNumber}
                      onChange={(event) =>
                        setTrainingForm((current) => ({
                          ...current,
                          lotNumber: event.target.value,
                        }))
                      }
                      placeholder="Lot number"
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
                    />
                    <input
                      value={trainingForm.quantityOnHand}
                      onChange={(event) =>
                        setTrainingForm((current) => ({
                          ...current,
                          quantityOnHand: event.target.value,
                        }))
                      }
                      placeholder="Quantity"
                      type="number"
                      min="0"
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
                    />
                    <input
                      value={trainingForm.costPerRound}
                      onChange={(event) =>
                        setTrainingForm((current) => ({
                          ...current,
                          costPerRound: event.target.value,
                        }))
                      }
                      placeholder="Cost per round"
                      type="number"
                      min="0"
                      step="0.01"
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
                    />
                    <input
                      value={trainingForm.lowStockThreshold}
                      onChange={(event) =>
                        setTrainingForm((current) => ({
                          ...current,
                          lowStockThreshold: event.target.value,
                        }))
                      }
                      placeholder="Low stock threshold"
                      type="number"
                      min="0"
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
                    />
                    <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 sm:col-span-2">
                      Purchase Date
                      <input
                        value={trainingForm.purchaseDate}
                        onChange={(event) =>
                          setTrainingForm((current) => ({
                            ...current,
                            purchaseDate: event.target.value,
                          }))
                        }
                        type="date"
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-emerald-500"
                      />
                    </label>
                    <textarea
                      value={trainingForm.notes}
                      onChange={(event) =>
                        setTrainingForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="Notes"
                      rows={3}
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500 sm:col-span-2"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleAddTrainingLot()}
                    disabled={saving}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save Training Lot
                  </button>
                </div>

                <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5">
                  <div className="flex items-center gap-2">
                    <Boxes className="h-5 w-5 text-emerald-300" />
                    <h2 className="text-lg font-bold text-white">
                      Issue to Range Day
                    </h2>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <select
                      value={trainingIssueForm.lotId}
                      onChange={(event) =>
                        setTrainingIssueForm((current) => ({
                          ...current,
                          lotId: event.target.value,
                        }))
                      }
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
                    >
                      <option value="">Select training lot...</option>
                      {trainingLots.map((lot) => (
                        <option key={lot.id} value={lot.id}>
                          {lot.caliber} • {lot.manufacturer} • {lot.lotNumber} •{" "}
                          {formatNumber(lot.quantityOnHand)} on hand
                        </option>
                      ))}
                    </select>
                    <input
                      value={trainingIssueForm.rangeDayTitle}
                      onChange={(event) =>
                        setTrainingIssueForm((current) => ({
                          ...current,
                          rangeDayTitle: event.target.value,
                        }))
                      }
                      placeholder="Range day / training event"
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
                    />
                    <div className="grid gap-3 sm:grid-cols-3">
                      <input
                        value={trainingIssueForm.quantityIssued}
                        onChange={(event) =>
                          setTrainingIssueForm((current) => ({
                            ...current,
                            quantityIssued: event.target.value,
                          }))
                        }
                        placeholder="Issued"
                        type="number"
                        min="0"
                        className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
                      />
                      <input
                        value={trainingIssueForm.quantityConsumed}
                        onChange={(event) =>
                          setTrainingIssueForm((current) => ({
                            ...current,
                            quantityConsumed: event.target.value,
                          }))
                        }
                        placeholder="Consumed"
                        type="number"
                        min="0"
                        className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
                      />
                      <input
                        value={trainingIssueForm.quantityReturned}
                        onChange={(event) =>
                          setTrainingIssueForm((current) => ({
                            ...current,
                            quantityReturned: event.target.value,
                          }))
                        }
                        placeholder="Returned"
                        type="number"
                        min="0"
                        className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
                      />
                    </div>
                    <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Issue Date
                      <input
                        value={trainingIssueForm.issueDate}
                        onChange={(event) =>
                          setTrainingIssueForm((current) => ({
                            ...current,
                            issueDate: event.target.value,
                          }))
                        }
                        type="date"
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-emerald-500"
                      />
                    </label>
                    <textarea
                      value={trainingIssueForm.notes}
                      onChange={(event) =>
                        setTrainingIssueForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="Range issue notes"
                      rows={3}
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleIssueTrainingAmmo()}
                    disabled={saving}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-bold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ClipboardList className="h-4 w-4" />
                    )}
                    Record Training Issue
                  </button>
                </div>
              </div>
            </section>
          )}

          <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-slate-400" />
              <h2 className="text-lg font-bold text-white">Recent Activity</h2>
            </div>

            {workspace.transactions.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                No ammunition activity has been recorded yet.
              </p>
            ) : (
              <div className="mt-4 divide-y divide-slate-800 rounded-3xl border border-slate-800">
                {workspace.transactions.slice(0, 8).map((transaction) => (
                  <div
                    key={transaction.id}
                    className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-semibold text-slate-100">
                        {transaction.description}
                      </p>
                      <p className="text-xs text-slate-500">
                        {new Date(transaction.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-bold ${
                        transaction.quantityChange >= 0
                          ? "border-emerald-800 bg-emerald-950/40 text-emerald-200"
                          : "border-amber-800 bg-amber-950/40 text-amber-200"
                      }`}
                    >
                      {transaction.quantityChange >= 0 ? "+" : ""}
                      {formatNumber(transaction.quantityChange)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-[2rem] border border-amber-800 bg-amber-950/30 p-4">
            <div className="flex gap-3 text-sm text-amber-100">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <div>
                <p className="font-bold">Pilot workspace note</p>
                <p className="mt-1 leading-6 text-amber-100/80">
                  This v1 uses a Supabase-backed pilot workspace. The next phase
                  should normalize ammunition lots, officer issues, range-day
                  issues, recalls, and audit history into dedicated tables.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </TracePointShell>
  );
}
