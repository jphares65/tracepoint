"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import ArmoryWorkspaceNav from "@/app/components/ArmoryWorkspaceNav";
import TracePointShell from "@/app/components/TracePointShell";

type PersonalRifleStatus =
  | "Draft"
  | "Submitted"
  | "Pending Armorer Review"
  | "Inspection Required"
  | "Armorer Approved"
  | "Armorer Denied"
  | "Pending Chief Approval"
  | "Approved"
  | "Denied"
  | "Suspended"
  | "Revoked"
  | "Expired";

type PersonalRifle = {
  id: string;
  owner_user_id: string;
  owner_name: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  caliber: string;
  barrel_length?: string | null;
  operating_system?: string | null;
  stock_brace_configuration?: string | null;
  sights_optic?: string | null;
  weapon_mounted_light?: string | null;
  sling?: string | null;
  trigger?: string | null;
  muzzle_device?: string | null;
  magazine_type?: string | null;
  other_modifications?: string | null;
  ownership_confirmed: boolean;
  specification_acknowledged: boolean;
  status: PersonalRifleStatus;
  submitted_at?: string | null;
  created_at: string;
};

type Rules = {
  allow_personally_owned_rifles: boolean;
  require_personal_rifle_armorer_inspection: boolean;
  require_personal_rifle_chief_approval: boolean;
  require_personal_rifle_qualification: boolean;
  require_personal_rifle_annual_reinspection: boolean;
  require_personal_rifle_spec_acknowledgment: boolean;
};

type Payload = {
  currentUserId: string;
  rifles: PersonalRifle[];
  rules: Rules;
};

type FormState = {
  manufacturer: string;
  model: string;
  serialNumber: string;
  caliber: string;
  barrelLength: string;
  operatingSystem: string;
  stockBraceConfiguration: string;
  sightsOptic: string;
  weaponMountedLight: string;
  sling: string;
  trigger: string;
  muzzleDevice: string;
  magazineType: string;
  otherModifications: string;
  ownershipConfirmed: boolean;
  specificationAcknowledged: boolean;
};

const EMPTY_FORM: FormState = {
  manufacturer: "",
  model: "",
  serialNumber: "",
  caliber: "",
  barrelLength: "",
  operatingSystem: "",
  stockBraceConfiguration: "",
  sightsOptic: "",
  weaponMountedLight: "",
  sling: "",
  trigger: "",
  muzzleDevice: "",
  magazineType: "",
  otherModifications: "",
  ownershipConfirmed: false,
  specificationAcknowledged: false,
};

const STATUS_STYLES: Record<PersonalRifleStatus, string> = {
  Draft: "border-slate-700 bg-slate-800 text-slate-300",
  Submitted: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  "Pending Armorer Review":
    "border-amber-500/40 bg-amber-500/10 text-amber-300",
  "Inspection Required":
    "border-orange-500/40 bg-orange-500/10 text-orange-300",
  "Armorer Approved":
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  "Armorer Denied": "border-red-500/40 bg-red-500/10 text-red-300",
  "Pending Chief Approval":
    "border-violet-500/40 bg-violet-500/10 text-violet-300",
  Approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  Denied: "border-red-500/40 bg-red-500/10 text-red-300",
  Suspended: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  Revoked: "border-red-500/40 bg-red-500/10 text-red-300",
  Expired: "border-slate-600 bg-slate-900 text-slate-400",
};

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? "The personal rifle request failed.";
  } catch {
    return "The personal rifle request failed.";
  }
}

function formatDate(value?: string | null) {
  if (!value) return "Not submitted";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not submitted";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function PersonalRiflesPage() {
  const [rifles, setRifles] = useState<PersonalRifle[]>([]);
  const [rules, setRules] = useState<Rules | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState<"draft" | "submit" | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const myRifles = useMemo(
    () => rifles.filter((rifle) => rifle.owner_user_id === currentUserId),
    [currentUserId, rifles],
  );

  async function loadRifles() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/armory/personal-rifles", {
        cache: "no-store",
      });

      if (!response.ok) throw new Error(await readError(response));

      const payload = (await response.json()) as Payload;
      setRifles(Array.isArray(payload.rifles) ? payload.rifles : []);
      setRules(payload.rules);
      setCurrentUserId(payload.currentUserId);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Personally owned rifles could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRifles();
  }, []);

  function updateField<K extends keyof FormState>(
    field: K,
    value: FormState[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveRifle(submit: boolean) {
    if (
      !form.manufacturer.trim() ||
      !form.model.trim() ||
      !form.serialNumber.trim() ||
      !form.caliber.trim()
    ) {
      setError("Manufacturer, model, serial number, and caliber are required.");
      return;
    }

    if (!form.ownershipConfirmed) {
      setError("You must confirm ownership of the rifle.");
      return;
    }

    if (
      submit &&
      rules?.require_personal_rifle_spec_acknowledgment &&
      !form.specificationAcknowledged
    ) {
      setError(
        "Department specification acknowledgment is required before submission.",
      );
      return;
    }

    setSavingAction(submit ? "submit" : "draft");
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/armory/personal-rifles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, submit }),
      });

      if (!response.ok) throw new Error(await readError(response));

      setMessage(
        submit
          ? "Personal rifle submitted for armorer review."
          : "Personal rifle draft saved.",
      );
      setForm(EMPTY_FORM);
      await loadRifles();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The personal rifle could not be saved.",
      );
    } finally {
      setSavingAction(null);
    }
  }

  const programEnabled = Boolean(rules?.allow_personally_owned_rifles);

  return (
    <TracePointShell activePage="Armory">
      <div className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-6 lg:p-8">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
          <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-400">
                  Armory
                </p>
                <h1 className="mt-2 text-3xl font-bold text-white">
                  Personally Owned Rifles
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
                  Submit and track personally owned rifles for agency duty-use
                  review. These records remain separate from assignable
                  department inventory.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void loadRifles()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-blue-500"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
            </div>

            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-300">
              <ShieldCheck className="h-4 w-4" />
              Ownership: Personally Owned
            </div>
          </section>

          <ArmoryWorkspaceNav />

          {(error || message) && (
            <section
              className={`rounded-2xl border p-4 text-sm ${
                error
                  ? "border-red-500/40 bg-red-500/10 text-red-200"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              }`}
            >
              {error ?? message}
            </section>
          )}

          {!loading && !programEnabled && (
            <section className="flex gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">
                  Personally owned rifles are not enabled for this agency.
                </p>
                <p className="mt-1 text-xs leading-5 text-amber-300/80">
                  An administrator can enable the program under Settings →
                  Rules Engine.
                </p>
              </div>
            </section>
          )}

          {loading ? (
            <div className="flex min-h-64 items-center justify-center rounded-3xl border border-slate-800 bg-slate-900">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading personal rifle records...
            </div>
          ) : (
            <section className="grid gap-6 xl:grid-cols-[minmax(420px,0.9fr)_minmax(0,1.2fr)]">
              <div className="rounded-[2rem] border border-slate-800 bg-slate-900 p-5">
                <div className="flex items-center gap-2">
                  <Plus className="h-5 w-5 text-blue-400" />
                  <h2 className="text-lg font-bold text-white">
                    Submit Personal Rifle
                  </h2>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Save a draft or submit the completed record for armorer
                  review.
                </p>

                <div
                  className={`mt-5 space-y-4 ${
                    programEnabled ? "" : "pointer-events-none opacity-50"
                  }`}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ["manufacturer", "Manufacturer"],
                      ["model", "Model"],
                      ["serialNumber", "Serial number"],
                      ["caliber", "Caliber"],
                      ["barrelLength", "Barrel length"],
                      ["operatingSystem", "Operating system"],
                      ["stockBraceConfiguration", "Stock / brace configuration"],
                      ["sightsOptic", "Sights / optic"],
                      ["weaponMountedLight", "Weapon-mounted light"],
                      ["sling", "Sling"],
                      ["trigger", "Trigger"],
                      ["muzzleDevice", "Muzzle device"],
                      ["magazineType", "Magazine type"],
                    ].map(([field, label]) => (
                      <input
                        key={field}
                        value={String(form[field as keyof FormState])}
                        onChange={(event) =>
                          updateField(
                            field as keyof FormState,
                            event.target.value as never,
                          )
                        }
                        placeholder={label}
                        className="rounded-2xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm outline-none transition focus:border-blue-500"
                      />
                    ))}
                  </div>

                  <textarea
                    value={form.otherModifications}
                    onChange={(event) =>
                      updateField("otherModifications", event.target.value)
                    }
                    rows={3}
                    placeholder="Other modifications"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm outline-none transition focus:border-blue-500"
                  />

                  <label className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <input
                      type="checkbox"
                      checked={form.ownershipConfirmed}
                      onChange={(event) =>
                        updateField("ownershipConfirmed", event.target.checked)
                      }
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-200">
                        Purchase and ownership confirmation
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        I confirm that I lawfully own this rifle and that the
                        information provided is accurate.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <input
                      type="checkbox"
                      checked={form.specificationAcknowledged}
                      onChange={(event) =>
                        updateField(
                          "specificationAcknowledged",
                          event.target.checked,
                        )
                      }
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-200">
                        Department specification acknowledgment
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        I acknowledge that approval is contingent on compliance
                        with department specifications and inspection.
                      </span>
                    </span>
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => void saveRifle(false)}
                      disabled={Boolean(savingAction)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 px-4 py-2.5 text-sm font-bold text-slate-200 transition hover:border-blue-500 disabled:opacity-50"
                    >
                      {savingAction === "draft" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ClipboardCheck className="h-4 w-4" />
                      )}
                      Save Draft
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveRifle(true)}
                      disabled={Boolean(savingAction)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-500 disabled:opacity-50"
                    >
                      {savingAction === "submit" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Submit for Review
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-[2rem] border border-slate-800 bg-slate-900 p-5">
                <h2 className="text-lg font-bold text-white">
                  Personal Rifle Records
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Your records appear first, followed by the agency review
                  queue.
                </p>

                {rifles.length === 0 ? (
                  <div className="mt-5 rounded-3xl border border-dashed border-slate-700 p-10 text-center text-sm text-slate-500">
                    No personally owned rifle records have been created.
                  </div>
                ) : (
                  <div className="mt-5 space-y-3">
                    {[...myRifles, ...rifles.filter(
                      (rifle) => rifle.owner_user_id !== currentUserId,
                    )].map((rifle) => (
                      <article
                        key={rifle.id}
                        className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-lg font-bold text-white">
                              {rifle.manufacturer} {rifle.model}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {rifle.caliber} · Serial {rifle.serial_number}
                            </p>
                            <p className="mt-2 text-xs text-slate-400">
                              Owner: {rifle.owner_name}
                            </p>
                          </div>

                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${
                              STATUS_STYLES[rifle.status]
                            }`}
                          >
                            {rifle.status}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
                          <div>
                            <p className="uppercase tracking-wider text-slate-600">
                              Ownership
                            </p>
                            <p className="mt-1 font-semibold text-blue-300">
                              Personally Owned
                            </p>
                          </div>
                          <div>
                            <p className="uppercase tracking-wider text-slate-600">
                              Submitted
                            </p>
                            <p className="mt-1 font-semibold text-slate-200">
                              {formatDate(rifle.submitted_at)}
                            </p>
                          </div>
                          <div>
                            <p className="uppercase tracking-wider text-slate-600">
                              Optic
                            </p>
                            <p className="mt-1 font-semibold text-slate-200">
                              {rifle.sights_optic || "Not recorded"}
                            </p>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </TracePointShell>
  );
}
