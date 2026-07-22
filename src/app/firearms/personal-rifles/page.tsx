"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FilePenLine,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react";

import ArmorySectionShell from "@/app/components/ArmorySectionShell";
import TracePointShell from "@/app/components/TracePointShell";

type Status =
  | "Draft"
  | "Correction Requested"
  | "Pending Armorer Review"
  | "Pending Chief Approval"
  | "Approved"
  | "Armorer Denied"
  | "Denied"
  | "Suspended"
  | "Revoked"
  | "Expired";

type HistoryEntry = {
  id: string;
  from_status: string | null;
  to_status: string;
  action: string;
  notes: string | null;
  actor_name: string;
  created_at: string;
};

type Rifle = {
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
  status: Status;
  submitted_at?: string | null;
  armorer_reviewed_at?: string | null;
  armorer_decision_notes?: string | null;
  armorer_checklist?: Record<string, boolean> | null;
  inspection_date?: string | null;
  qualification_verified?: boolean;
  chief_reviewed_at?: string | null;
  chief_decision_notes?: string | null;
  approval_date?: string | null;
  expiration_date?: string | null;
  correction_notes?: string | null;
  suspension_notes?: string | null;
  revocation_notes?: string | null;
  created_at: string;
  updated_at: string;
  history: HistoryEntry[];
};

type Rules = {
  allow_personally_owned_rifles: boolean;
  require_personal_rifle_armorer_inspection: boolean;
  require_personal_rifle_chief_approval: boolean;
  require_personal_rifle_qualification: boolean;
  require_personal_rifle_annual_reinspection: boolean;
  require_personal_rifle_spec_acknowledgment: boolean;
  personal_rifle_approval_months: number;
  personal_rifle_policy_text: string;
};

type Access = {
  canSubmit: boolean;
  canViewAll: boolean;
  canArmorerReview: boolean;
  canChiefReview: boolean;
  canConfigure: boolean;
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

type Checklist = {
  serial_verified: boolean;
  safe_function: boolean;
  department_specifications: boolean;
  optic_sights: boolean;
  sling_light: boolean;
  trigger_muzzle: boolean;
};

type Tab = "records" | "review" | "settings";

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

const EMPTY_CHECKLIST: Checklist = {
  serial_verified: false,
  safe_function: false,
  department_specifications: false,
  optic_sights: false,
  sling_light: false,
  trigger_muzzle: false,
};

const CHECKLIST_ITEMS: Array<{ key: keyof Checklist; label: string }> = [
  { key: "serial_verified", label: "Serial number physically verified" },
  { key: "safe_function", label: "Safety and function inspection passed" },
  {
    key: "department_specifications",
    label: "Rifle meets department specifications",
  },
  { key: "optic_sights", label: "Optic / sights inspected and serviceable" },
  { key: "sling_light", label: "Sling / weapon light inspected" },
  { key: "trigger_muzzle", label: "Trigger and muzzle device acceptable" },
];

const STATUS_STYLE: Record<Status, string> = {
  Draft: "border-slate-700 bg-slate-800 text-slate-300",
  "Correction Requested":
    "border-orange-500/40 bg-orange-500/10 text-orange-300",
  "Pending Armorer Review":
    "border-amber-500/40 bg-amber-500/10 text-amber-300",
  "Pending Chief Approval":
    "border-violet-500/40 bg-violet-500/10 text-violet-300",
  Approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  "Armorer Denied": "border-red-500/40 bg-red-500/10 text-red-300",
  Denied: "border-red-500/40 bg-red-500/10 text-red-300",
  Suspended: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  Revoked: "border-red-500/40 bg-red-500/10 text-red-300",
  Expired: "border-slate-700 bg-slate-950 text-slate-500",
};

function fieldClass() {
  return "mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-blue-500";
}

function formatDate(value?: string | null) {
  if (!value) return "Not recorded";
  const date = value.includes("T")
    ? new Date(value)
    : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? "The personal rifle request failed.";
  } catch {
    return "The personal rifle request failed.";
  }
}

function formFromRifle(rifle: Rifle): FormState {
  return {
    manufacturer: rifle.manufacturer,
    model: rifle.model,
    serialNumber: rifle.serial_number,
    caliber: rifle.caliber,
    barrelLength: rifle.barrel_length ?? "",
    operatingSystem: rifle.operating_system ?? "",
    stockBraceConfiguration: rifle.stock_brace_configuration ?? "",
    sightsOptic: rifle.sights_optic ?? "",
    weaponMountedLight: rifle.weapon_mounted_light ?? "",
    sling: rifle.sling ?? "",
    trigger: rifle.trigger ?? "",
    muzzleDevice: rifle.muzzle_device ?? "",
    magazineType: rifle.magazine_type ?? "",
    otherModifications: rifle.other_modifications ?? "",
    ownershipConfirmed: rifle.ownership_confirmed,
    specificationAcknowledged: rifle.specification_acknowledged,
  };
}

function Label({
  text,
  children,
}: {
  text: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {text}
      </span>
      {children}
    </label>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
        {label}
      </p>
      <p className="mt-1 text-sm text-slate-200">{value || "Not entered"}</p>
    </div>
  );
}

export default function PersonalRiflesPage() {
  const [rifles, setRifles] = useState<Rifle[]>([]);
  const [rules, setRules] = useState<Rules | null>(null);
  const [access, setAccess] = useState<Access>({
    canSubmit: true,
    canViewAll: false,
    canArmorerReview: false,
    canChiefReview: false,
    canConfigure: false,
  });
  const [currentUserId, setCurrentUserId] = useState("");
  const [tab, setTab] = useState<Tab>("records");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [checklist, setChecklist] = useState<Checklist>(EMPTY_CHECKLIST);
  const [inspectionDate, setInspectionDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [qualificationVerified, setQualificationVerified] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => rifles.find((rifle) => rifle.id === selectedId) ?? null,
    [rifles, selectedId],
  );

  const reviewQueue = useMemo(
    () =>
      rifles.filter((rifle) =>
        ["Pending Armorer Review", "Pending Chief Approval"].includes(
          rifle.status,
        ),
      ),
    [rifles],
  );

  const orderedRifles = useMemo(() => {
    const order: Record<Status, number> = {
      "Pending Armorer Review": 0,
      "Pending Chief Approval": 1,
      "Correction Requested": 2,
      Draft: 3,
      Approved: 4,
      Suspended: 5,
      "Armorer Denied": 6,
      Denied: 7,
      Revoked: 8,
      Expired: 9,
    };

    return [...rifles].sort(
      (left, right) =>
        order[left.status] - order[right.status] ||
        right.updated_at.localeCompare(left.updated_at),
    );
  }, [rifles]);

  async function load(preserveSelection = true) {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/armory/personal-rifles", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await readError(response));

      const payload = (await response.json()) as {
        currentUserId: string;
        rifles: Rifle[];
        rules: Rules;
        access: Access;
      };

      const nextRifles = Array.isArray(payload.rifles)
        ? payload.rifles
        : [];
      setRifles(nextRifles);
      setRules(payload.rules);
      setAccess(payload.access);
      setCurrentUserId(payload.currentUserId);

      const params =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : null;
      const requestedId = params?.get("record");
      const editRequested = params?.get("edit") === "1";
      const reviewRequested = params?.get("view") === "review";

      if (reviewRequested) setTab("review");

      const nextSelected =
        requestedId && nextRifles.some((rifle) => rifle.id === requestedId)
          ? requestedId
          : preserveSelection &&
              selectedId &&
              nextRifles.some((rifle) => rifle.id === selectedId)
            ? selectedId
            : nextRifles[0]?.id ?? null;

      setSelectedId(nextSelected);

      if (editRequested && nextSelected) {
        const rifle = nextRifles.find((item) => item.id === nextSelected);
        if (
          rifle &&
          rifle.owner_user_id === payload.currentUserId &&
          ["Draft", "Correction Requested"].includes(rifle.status)
        ) {
          setEditingId(rifle.id);
          setForm(formFromRifle(rifle));
          setShowForm(true);
        }
      }
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
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setReviewNotes("");
    setInspectionDate(
      selected?.inspection_date ?? new Date().toISOString().slice(0, 10),
    );
    setQualificationVerified(Boolean(selected?.qualification_verified));
    setChecklist({
      ...EMPTY_CHECKLIST,
      ...(selected?.armorer_checklist ?? {}),
    });
  }, [selected]);

  function beginNew() {
    setEditingId(null);
    setSelectedId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setTab("records");
  }

  function beginEdit(rifle: Rifle) {
    setEditingId(rifle.id);
    setSelectedId(rifle.id);
    setForm(formFromRifle(rifle));
    setShowForm(true);
    setTab("records");
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
      setError("Ownership confirmation is required.");
      return;
    }
    if (
      submit &&
      rules?.require_personal_rifle_spec_acknowledgment &&
      !form.specificationAcknowledged
    ) {
      setError("Department specification acknowledgment is required.");
      return;
    }

    setSaving(submit ? "submit" : "draft");
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        editingId
          ? `/api/armory/personal-rifles/${editingId}`
          : "/api/armory/personal-rifles",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editingId
              ? {
                  action: submit ? "owner_submit" : "owner_save",
                  rifle: form,
                }
              : { ...form, submit },
          ),
        },
      );

      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as {
        personalRifleId?: string;
      };

      setMessage(
        submit
          ? "Personal rifle submitted for review."
          : "Personal rifle draft saved.",
      );
      setEditingId(null);
      setShowForm(false);
      setForm(EMPTY_FORM);
      await load(false);
      if (payload.personalRifleId) setSelectedId(payload.personalRifleId);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The personal rifle could not be saved.",
      );
    } finally {
      setSaving(null);
    }
  }

  async function performAction(action: string) {
    if (!selected) return;

    if (
      ["request_correction", "armorer_deny", "chief_deny", "suspend", "revoke"].includes(
        action,
      ) &&
      !reviewNotes.trim()
    ) {
      setError("Enter a reason before completing this action.");
      return;
    }

    setSaving(action);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/armory/personal-rifles/${selected.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            notes: reviewNotes.trim() || null,
            inspectionDate,
            qualificationVerified,
            checklist,
          }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));

      setMessage("Personal rifle workflow updated.");
      setReviewNotes("");
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "The workflow action could not be completed.",
      );
    } finally {
      setSaving(null);
    }
  }

  async function saveRules() {
    if (!rules) return;
    setSaving("rules");
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        "/api/armory/personal-rifles/rules",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rules),
        },
      );
      if (!response.ok) throw new Error(await readError(response));

      const payload = (await response.json()) as { rules: Rules };
      setRules(payload.rules);
      setMessage("Personally owned rifle program settings saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Program settings could not be saved.",
      );
    } finally {
      setSaving(null);
    }
  }

  const list = tab === "review" ? reviewQueue : orderedRifles;
  const ownerCanEdit =
    selected?.owner_user_id === currentUserId &&
    ["Draft", "Correction Requested"].includes(selected.status);
  const canArmorerAct =
    access.canArmorerReview &&
    selected?.status === "Pending Armorer Review";
  const canChiefAct =
    access.canChiefReview &&
    selected?.status === "Pending Chief Approval";

  return (
    <TracePointShell activePage="Armory">
      <div className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-6 lg:p-8">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
          <ArmorySectionShell
            title="Personally Owned Rifles"
            description="Officer submission, armorer inspection, Chief approval, and permanent decision history."
            actions={
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading || Boolean(saving)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-300 hover:text-white disabled:opacity-50"
              >
                <RefreshCw size={15} />
                Refresh
              </button>
            }
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTab("records")}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${
                tab === "records"
                  ? "border-blue-500/50 bg-blue-500/10 text-blue-200"
                  : "border-slate-800 bg-slate-900 text-slate-400"
              }`}
            >
              <UserRound size={15} />
              Rifle Records
            </button>
            {(access.canArmorerReview || access.canChiefReview) && (
              <button
                type="button"
                onClick={() => setTab("review")}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${
                  tab === "review"
                    ? "border-blue-500/50 bg-blue-500/10 text-blue-200"
                    : "border-slate-800 bg-slate-900 text-slate-400"
                }`}
              >
                <ClipboardCheck size={15} />
                Review Queue
                {reviewQueue.length > 0 && (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200">
                    {reviewQueue.length}
                  </span>
                )}
              </button>
            )}
            {access.canConfigure && (
              <button
                type="button"
                onClick={() => setTab("settings")}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${
                  tab === "settings"
                    ? "border-blue-500/50 bg-blue-500/10 text-blue-200"
                    : "border-slate-800 bg-slate-900 text-slate-400"
                }`}
              >
                <Settings size={15} />
                Program Settings
              </button>
            )}
          </div>

          {error && (
            <div className="flex gap-3 rounded-2xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              {error}
            </div>
          )}
          {message && (
            <div className="flex gap-3 rounded-2xl border border-emerald-800 bg-emerald-950/35 p-4 text-sm text-emerald-200">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              {message}
            </div>
          )}

          {!loading && rules && !rules.allow_personally_owned_rifles && (
            <div className="flex gap-3 rounded-2xl border border-amber-700/60 bg-amber-950/25 p-4 text-sm text-amber-200">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">
                  The personally owned rifle program is disabled.
                </p>
                <p className="mt-1 text-xs text-amber-300/70">
                  An agency administrator can enable it under Program Settings.
                </p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex min-h-[380px] items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/60">
              <Loader2 className="h-8 w-8 animate-spin text-blue-300" />
            </div>
          ) : null}

          {!loading && tab === "settings" && rules && access.canConfigure ? (
            <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center gap-3">
                <Settings className="h-5 w-5 text-blue-300" />
                <div>
                  <h2 className="font-bold text-white">Program Configuration</h2>
                  <p className="text-sm text-slate-500">
                    Each agency controls whether the program is available and which approval stages are required.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {[
                  ["allow_personally_owned_rifles", "Enable personally owned rifles"],
                  ["require_personal_rifle_armorer_inspection", "Require armorer inspection"],
                  ["require_personal_rifle_chief_approval", "Require Chief approval"],
                  ["require_personal_rifle_qualification", "Require qualification verification"],
                  ["require_personal_rifle_annual_reinspection", "Set approval expiration"],
                  ["require_personal_rifle_spec_acknowledgment", "Require officer policy acknowledgment"],
                ].map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(rules[key as keyof Rules])}
                      onChange={(event) =>
                        setRules((current) =>
                          current
                            ? {
                                ...current,
                                [key]: event.target.checked,
                              }
                            : current,
                        )
                      }
                    />
                    <span className="text-sm font-semibold text-slate-300">
                      {label}
                    </span>
                  </label>
                ))}
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr]">
                <Label text="Approval Term (Months)">
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={rules.personal_rifle_approval_months}
                    onChange={(event) =>
                      setRules((current) =>
                        current
                          ? {
                              ...current,
                              personal_rifle_approval_months: Math.max(
                                1,
                                Number(event.target.value) || 1,
                              ),
                            }
                          : current,
                      )
                    }
                    disabled={!rules.require_personal_rifle_annual_reinspection}
                    className={fieldClass()}
                  />
                </Label>
                <Label text="Agency Policy / Specification Statement">
                  <textarea
                    rows={5}
                    value={rules.personal_rifle_policy_text}
                    onChange={(event) =>
                      setRules((current) =>
                        current
                          ? {
                              ...current,
                              personal_rifle_policy_text: event.target.value,
                            }
                          : current,
                      )
                    }
                    placeholder="Enter the department's rifle specifications or policy acknowledgment text."
                    className={fieldClass()}
                  />
                </Label>
              </div>

              <button
                type="button"
                onClick={() => void saveRules()}
                disabled={Boolean(saving)}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {saving === "rules" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Save size={15} />
                )}
                Save Program Settings
              </button>
            </section>
          ) : null}

          {!loading && tab !== "settings" ? (
            <>
              {showForm ? (
                <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <FilePenLine className="h-5 w-5 text-blue-300" />
                      <div>
                        <h2 className="font-bold text-white">
                          {editingId ? "Edit Rifle Submission" : "New Rifle Submission"}
                        </h2>
                        <p className="text-sm text-slate-500">
                          Save a draft or submit it into the agency review workflow.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false);
                        setEditingId(null);
                        setForm(EMPTY_FORM);
                      }}
                      className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-400"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      ["manufacturer", "Manufacturer"],
                      ["model", "Model"],
                      ["serialNumber", "Serial Number"],
                      ["caliber", "Caliber"],
                      ["barrelLength", "Barrel Length"],
                      ["operatingSystem", "Operating System"],
                      ["stockBraceConfiguration", "Stock / Brace"],
                      ["sightsOptic", "Sights / Optic"],
                      ["weaponMountedLight", "Weapon Light"],
                      ["sling", "Sling"],
                      ["trigger", "Trigger"],
                      ["muzzleDevice", "Muzzle Device"],
                      ["magazineType", "Magazine Type"],
                    ].map(([key, label]) => (
                      <Label key={key} text={label}>
                        <input
                          value={String(form[key as keyof FormState])}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                          className={fieldClass()}
                        />
                      </Label>
                    ))}
                  </div>

                  <Label text="Other Modifications">
                    <textarea
                      rows={3}
                      value={form.otherModifications}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          otherModifications: event.target.value,
                        }))
                      }
                      className={fieldClass()}
                    />
                  </Label>

                  {rules?.personal_rifle_policy_text && (
                    <div className="mt-4 rounded-2xl border border-blue-800/60 bg-blue-950/25 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">
                        Agency Policy / Specifications
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-blue-100/80">
                        {rules.personal_rifle_policy_text}
                      </p>
                    </div>
                  )}

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                      <input
                        type="checkbox"
                        checked={form.ownershipConfirmed}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            ownershipConfirmed: event.target.checked,
                          }))
                        }
                        className="mt-1"
                      />
                      <span className="text-sm text-slate-300">
                        I confirm lawful ownership and the accuracy of this record.
                      </span>
                    </label>
                    <label className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                      <input
                        type="checkbox"
                        checked={form.specificationAcknowledged}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            specificationAcknowledged: event.target.checked,
                          }))
                        }
                        className="mt-1"
                      />
                      <span className="text-sm text-slate-300">
                        I acknowledge the department policy and rifle specifications.
                      </span>
                    </label>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void saveRifle(false)}
                      disabled={Boolean(saving)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-slate-300 disabled:opacity-50"
                    >
                      <Save size={15} />
                      Save Draft
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveRifle(true)}
                      disabled={
                        Boolean(saving) ||
                        !rules?.allow_personally_owned_rifles
                      }
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      {saving === "submit" ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <ShieldCheck size={15} />
                      )}
                      Submit for Review
                    </button>
                  </div>
                </section>
              ) : null}

              <section className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
                <div className="rounded-3xl border border-slate-800 bg-slate-900/70">
                  <div className="flex items-center justify-between border-b border-slate-800 p-4">
                    <div>
                      <h2 className="font-bold text-white">
                        {tab === "review" ? "Review Queue" : "Rifle Records"}
                      </h2>
                      <p className="mt-1 text-xs text-slate-500">
                        {list.length} record{list.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    {tab === "records" && (
                      <button
                        type="button"
                        onClick={beginNew}
                        disabled={!rules?.allow_personally_owned_rifles}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        <Plus size={14} />
                        New
                      </button>
                    )}
                  </div>

                  <div className="max-h-[720px] space-y-2 overflow-y-auto p-3">
                    {list.map((rifle) => (
                      <button
                        key={rifle.id}
                        type="button"
                        onClick={() => setSelectedId(rifle.id)}
                        className={`w-full rounded-2xl border p-4 text-left transition ${
                          selectedId === rifle.id
                            ? "border-blue-500/50 bg-blue-500/10"
                            : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-white">
                              {rifle.manufacturer} {rifle.model}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {rifle.owner_name} · {rifle.caliber}
                            </p>
                          </div>
                          <span
                            className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${STATUS_STYLE[rifle.status]}`}
                          >
                            {rifle.status}
                          </span>
                        </div>
                      </button>
                    ))}
                    {list.length === 0 && (
                      <p className="p-6 text-center text-sm text-slate-500">
                        {tab === "review"
                          ? "No rifle approvals are waiting."
                          : "No personal rifle records."}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  {!selected ? (
                    <div className="flex min-h-[420px] items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 text-sm text-slate-500">
                      Select a rifle record.
                    </div>
                  ) : (
                    <>
                      <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-400">
                              {selected.owner_name}
                            </p>
                            <h2 className="mt-2 text-2xl font-bold text-white">
                              {selected.manufacturer} {selected.model}
                            </h2>
                            <p className="mt-1 text-sm text-slate-500">
                              {selected.caliber} · Serial {selected.serial_number}
                            </p>
                          </div>
                          <span
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${STATUS_STYLE[selected.status]}`}
                          >
                            {selected.status}
                          </span>
                        </div>

                        {selected.correction_notes && (
                          <div className="mt-4 rounded-2xl border border-orange-700/60 bg-orange-950/25 p-4 text-sm text-orange-200">
                            <strong>Correction requested:</strong>{" "}
                            {selected.correction_notes}
                          </div>
                        )}

                        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <Detail label="Barrel Length" value={selected.barrel_length} />
                          <Detail label="Operating System" value={selected.operating_system} />
                          <Detail label="Stock / Brace" value={selected.stock_brace_configuration} />
                          <Detail label="Sights / Optic" value={selected.sights_optic} />
                          <Detail label="Weapon Light" value={selected.weapon_mounted_light} />
                          <Detail label="Sling" value={selected.sling} />
                          <Detail label="Trigger" value={selected.trigger} />
                          <Detail label="Muzzle Device" value={selected.muzzle_device} />
                          <Detail label="Magazine Type" value={selected.magazine_type} />
                          <Detail label="Submitted" value={formatDate(selected.submitted_at)} />
                          <Detail label="Approved" value={formatDate(selected.approval_date)} />
                          <Detail label="Expires" value={formatDate(selected.expiration_date)} />
                        </div>

                        {selected.other_modifications && (
                          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                              Other Modifications
                            </p>
                            <p className="mt-1 text-sm text-slate-300">
                              {selected.other_modifications}
                            </p>
                          </div>
                        )}

                        {ownerCanEdit && (
                          <button
                            type="button"
                            onClick={() => beginEdit(selected)}
                            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-300"
                          >
                            <FilePenLine size={15} />
                            Edit Submission
                          </button>
                        )}
                      </section>

                      {canArmorerAct && (
                        <section className="rounded-3xl border border-amber-800/60 bg-amber-950/15 p-5">
                          <div className="flex items-center gap-3">
                            <ClipboardCheck className="h-5 w-5 text-amber-300" />
                            <div>
                              <h3 className="font-bold text-white">Armorer Review</h3>
                              <p className="text-sm text-slate-500">
                                Complete the inspection and determine whether the rifle advances to command approval.
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            {CHECKLIST_ITEMS.map((item) => (
                              <label
                                key={item.key}
                                className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3"
                              >
                                <input
                                  type="checkbox"
                                  checked={checklist[item.key]}
                                  onChange={(event) =>
                                    setChecklist((current) => ({
                                      ...current,
                                      [item.key]: event.target.checked,
                                    }))
                                  }
                                />
                                <span className="text-sm text-slate-300">
                                  {item.label}
                                </span>
                              </label>
                            ))}
                          </div>

                          <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <Label text="Inspection Date">
                              <input
                                type="date"
                                value={inspectionDate}
                                onChange={(event) =>
                                  setInspectionDate(event.target.value)
                                }
                                className={fieldClass()}
                              />
                            </Label>
                            <label className="mt-5 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5">
                              <input
                                type="checkbox"
                                checked={qualificationVerified}
                                onChange={(event) =>
                                  setQualificationVerified(event.target.checked)
                                }
                              />
                              <span className="text-sm text-slate-300">
                                Qualification verified
                              </span>
                            </label>
                          </div>

                          <Label text="Review Notes / Correction or Denial Reason">
                            <textarea
                              rows={3}
                              value={reviewNotes}
                              onChange={(event) =>
                                setReviewNotes(event.target.value)
                              }
                              className={fieldClass()}
                            />
                          </Label>

                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void performAction("armorer_approve")}
                              disabled={Boolean(saving)}
                              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              <Check size={15} />
                              Pass Armorer Review
                            </button>
                            <button
                              type="button"
                              onClick={() => void performAction("request_correction")}
                              disabled={Boolean(saving)}
                              className="inline-flex items-center gap-2 rounded-xl border border-orange-700 bg-orange-950/30 px-4 py-2.5 text-sm font-semibold text-orange-200 disabled:opacity-50"
                            >
                              <Clock3 size={15} />
                              Request Correction
                            </button>
                            <button
                              type="button"
                              onClick={() => void performAction("armorer_deny")}
                              disabled={Boolean(saving)}
                              className="inline-flex items-center gap-2 rounded-xl border border-red-800 bg-red-950/30 px-4 py-2.5 text-sm font-semibold text-red-200 disabled:opacity-50"
                            >
                              <XCircle size={15} />
                              Deny
                            </button>
                          </div>
                        </section>
                      )}

                      {canChiefAct && (
                        <section className="rounded-3xl border border-violet-800/60 bg-violet-950/15 p-5">
                          <div className="flex items-center gap-3">
                            <ShieldCheck className="h-5 w-5 text-violet-300" />
                            <div>
                              <h3 className="font-bold text-white">Chief Approval</h3>
                              <p className="text-sm text-slate-500">
                                The armorer inspection is complete. Record the final agency decision.
                              </p>
                            </div>
                          </div>
                          <Label text="Decision Notes / Denial Reason">
                            <textarea
                              rows={3}
                              value={reviewNotes}
                              onChange={(event) =>
                                setReviewNotes(event.target.value)
                              }
                              className={fieldClass()}
                            />
                          </Label>
                          <div className="mt-4 flex gap-2">
                            <button
                              type="button"
                              onClick={() => void performAction("chief_approve")}
                              disabled={Boolean(saving)}
                              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              <ShieldCheck size={15} />
                              Approve for Duty Use
                            </button>
                            <button
                              type="button"
                              onClick={() => void performAction("chief_deny")}
                              disabled={Boolean(saving)}
                              className="inline-flex items-center gap-2 rounded-xl border border-red-800 bg-red-950/30 px-4 py-2.5 text-sm font-semibold text-red-200 disabled:opacity-50"
                            >
                              <XCircle size={15} />
                              Deny
                            </button>
                          </div>
                        </section>
                      )}

                      {access.canChiefReview &&
                        ["Approved", "Suspended"].includes(selected.status) && (
                          <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
                            <h3 className="font-bold text-white">Command Controls</h3>
                            <p className="mt-1 text-sm text-slate-500">
                              Suspend, reinstate, or permanently revoke an existing approval.
                            </p>
                            <Label text="Command Action Reason">
                              <textarea
                                rows={3}
                                value={reviewNotes}
                                onChange={(event) =>
                                  setReviewNotes(event.target.value)
                                }
                                className={fieldClass()}
                              />
                            </Label>
                            <div className="mt-4 flex flex-wrap gap-2">
                              {selected.status === "Approved" ? (
                                <button
                                  type="button"
                                  onClick={() => void performAction("suspend")}
                                  disabled={Boolean(saving)}
                                  className="rounded-xl border border-amber-700 bg-amber-950/30 px-4 py-2 text-sm font-semibold text-amber-200"
                                >
                                  Suspend Approval
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void performAction("reinstate")}
                                  disabled={Boolean(saving)}
                                  className="rounded-xl border border-emerald-700 bg-emerald-950/30 px-4 py-2 text-sm font-semibold text-emerald-200"
                                >
                                  Reinstate Approval
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void performAction("revoke")}
                                disabled={Boolean(saving)}
                                className="rounded-xl border border-red-800 bg-red-950/30 px-4 py-2 text-sm font-semibold text-red-200"
                              >
                                Revoke Approval
                              </button>
                            </div>
                          </section>
                        )}

                      <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
                        <div className="flex items-center gap-3">
                          <History className="h-5 w-5 text-blue-300" />
                          <div>
                            <h3 className="font-bold text-white">Decision History</h3>
                            <p className="text-sm text-slate-500">
                              Every workflow transition is retained.
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 space-y-3">
                          {selected.history.map((entry) => (
                            <div
                              key={entry.id}
                              className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-semibold text-white">
                                    {entry.action}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {entry.actor_name} · {entry.from_status ?? "New"} →{" "}
                                    {entry.to_status}
                                  </p>
                                </div>
                                <p className="text-xs text-slate-600">
                                  {formatDate(entry.created_at)}
                                </p>
                              </div>
                              {entry.notes && (
                                <p className="mt-2 text-sm text-slate-400">
                                  {entry.notes}
                                </p>
                              )}
                            </div>
                          ))}
                          {selected.history.length === 0 && (
                            <p className="text-sm text-slate-500">
                              No workflow history recorded.
                            </p>
                          )}
                        </div>
                      </section>
                    </>
                  )}
                </div>
              </section>
            </>
          ) : null}

          {saving && (
            <div className="fixed bottom-5 right-5 flex items-center gap-2 rounded-xl border border-blue-800 bg-slate-900 px-4 py-3 text-sm font-semibold text-blue-200 shadow-xl">
              <Loader2 size={16} className="animate-spin" />
              Saving personal rifle workflow
            </div>
          )}
        </div>
      </div>
    </TracePointShell>
  );
}
