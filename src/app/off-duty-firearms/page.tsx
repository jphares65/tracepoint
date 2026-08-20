"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type FormEvent,
} from "react";
import TracePointShell from "@/app/components/TracePointShell";
import {
  CHIEF_PROFILE,
  CURRENT_USER_PROFILE,
} from "@/app/lib/tracepoint/current-user";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Clock,
  Crosshair,
  FileCheck,
  History,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  X,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PortalMode = "Officer Portal" | "Department View";

type RequestStatus =
  | "Draft"
  | "Pending Command Review"
  | "Returned for Correction"
  | "Approved"
  | "Denied"
  | "Withdrawn";

type AuthorizationStatus =
  | "Not Authorized"
  | "Authorized"
  | "Expiring Soon"
  | "Expired"
  | "Revoked";

type InspectionStatus = "Not Inspected" | "Current" | "Due Soon" | "Overdue";

type OffDutyInspectionHistoryItem = {
  id: string;
  inspectionDate: string;
  result: "Pass" | "Fail";
  notes?: string;
  inspectedBy: string;
  inspectedByUserId: string;
  createdAt: string;
};
type ComplianceStatus = "Authorized" | "At Risk" | "Non-Compliant";

type OffDutyTab =
  | "All Records"
  | "Pending Approvals"
  | "Authorized"
  | "Expiring / Due"
  | "Needs Action";

type AuditAction =
  | "Submitted"
  | "Resubmitted"
  | "Approved"
  | "Denied"
  | "Returned for Correction"
  | "Revoked";

type AuditEvent = {
  id: string;
  action: AuditAction;
  actor: string;
  actorRole: string;
  timestamp: string;
  notes?: string;
};

type OffDutyFirearm = {
  id: string;
  officerId: string;
  officer: string;
  badge: string;
  unit: string;
  make: string;
  model: string;
  firearmType: string;
  serial: string;
  caliber: string;
  capacity: string;
  optic: string;
  weaponLight: string;
  holster: string;
  proofOwnership: boolean;
  qualificationReviewed: boolean;
  inspectionReviewed: boolean;
  policyAcknowledged: boolean;
  officerNotes: string;
  requestStatus: RequestStatus;
  authorizationStatus: AuthorizationStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  approvalDate?: string;
  approvalExpires?: string;  decisionNotes?: string;
  lastQual: string;
  qualificationStatus: string;
  qualificationReason: string;
  inspectionStatus: InspectionStatus;
  compliance: ComplianceStatus;
  auditTrail: AuditEvent[];
};

type RequestFormData = Pick<
  OffDutyFirearm,
  | "make"
  | "model"
  | "firearmType"
  | "serial"
  | "caliber"
  | "capacity"
  | "optic"
  | "weaponLight"
  | "holster"
  | "proofOwnership"
  | "qualificationReviewed"
  | "inspectionReviewed"
  | "policyAcknowledged"
  | "officerNotes"
>;

type KpiCardProps = {
  label: string;
  value: number;
  icon: ComponentType<{ size?: number; className?: string }>;
  color: string;
  sub: string;
};

// ---------------------------------------------------------------------------
// Constants / identities
// ---------------------------------------------------------------------------

const TABS: OffDutyTab[] = [
  "All Records",
  "Pending Approvals",
  "Authorized",
  "Expiring / Due",
  "Needs Action",
];


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function oneYearFromTodayInputValue() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

function formatDate(value?: string) {
  if (!value) return "?";

  const parsed = value.includes("T") ? new Date(value) : new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getInitials(name: string) {
  return name
    .replace(/Sgt\.|Off\.|Det\.|Lt\.|Chief/g, "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function statusClass(status: string) {
  switch (status) {
    case "Approved":
    case "Authorized":
    case "Current":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "Pending Command Review":
    case "Due Soon":
    case "At Risk":
    case "Expiring Soon":
    case "Returned for Correction":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "Denied":
    case "Expired":
    case "Revoked":
    case "Overdue":
    case "Non-Compliant":
    case "Not Authorized":
      return "border-red-500/30 bg-red-500/10 text-red-300";
    default:
      return "border-slate-600 bg-slate-800 text-slate-300";
  }
}

function StatusBadge({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClass(
        value,
      )}`}
    >
      {value}
    </span>
  );
}

function KpiCard({ label, value, icon: Icon, color, sub }: KpiCardProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
          {label}
        </p>
        <Icon size={14} className={color} />
      </div>
      <p className={`mt-1 text-2xl font-bold leading-none ${color}`}>{value}</p>
      <p className="mt-1 text-[10px] text-slate-600">{sub}</p>
    </div>
  );
}

function matchesTab(record: OffDutyFirearm, tab: OffDutyTab) {
  switch (tab) {
    case "All Records":
      return true;
    case "Pending Approvals":
      return record.requestStatus === "Pending Command Review";
    case "Authorized":
      return record.authorizationStatus === "Authorized";
    case "Expiring / Due":
      return (
        record.authorizationStatus === "Expiring Soon" ||
        record.authorizationStatus === "Expired" ||
        record.inspectionStatus !== "Current"
      );
    case "Needs Action":
      return (
        record.requestStatus === "Returned for Correction" ||
        record.requestStatus === "Denied" ||
        record.authorizationStatus === "Revoked" ||
        record.compliance !== "Authorized"
      );
    default:
      return true;
  }
}

function getFirearmLabel(record: OffDutyFirearm) {
  return `${record.make} ${record.model}`.trim();
}

// ---------------------------------------------------------------------------
// Submission drawer
// ---------------------------------------------------------------------------

function RequestDrawer({
  onClose,
  onSubmit,
  initialRecord,
}: {
  onClose: () => void;
  onSubmit: (data: RequestFormData) => void;
  initialRecord?: OffDutyFirearm | null;
}) {
  const [make, setMake] = useState(initialRecord?.make ?? "");
  const [model, setModel] = useState(initialRecord?.model ?? "");
  const [firearmType, setFirearmType] = useState(
    initialRecord?.firearmType ?? "Semi-Automatic Pistol",
  );
  const [serial, setSerial] = useState(initialRecord?.serial ?? "");
  const [caliber, setCaliber] = useState(initialRecord?.caliber ?? "");
  const [capacity, setCapacity] = useState(initialRecord?.capacity ?? "");
  const [optic, setOptic] = useState(initialRecord?.optic ?? "");
  const [weaponLight, setWeaponLight] = useState(
    initialRecord?.weaponLight ?? "",
  );
  const [holster, setHolster] = useState(initialRecord?.holster ?? "");
  const [proofOwnership, setProofOwnership] = useState(
    initialRecord?.proofOwnership ?? false,
  );
  const [qualificationReviewed, setQualificationReviewed] = useState(
    initialRecord?.qualificationReviewed ?? false,
  );
  const [inspectionReviewed, setInspectionReviewed] = useState(
    initialRecord?.inspectionReviewed ?? false,
  );
  const [policyAcknowledged, setPolicyAcknowledged] = useState(
    initialRecord?.policyAcknowledged ?? false,
  );
  const [officerNotes, setOfficerNotes] = useState(
    initialRecord?.officerNotes ?? "",
  );
  const [error, setError] = useState("");

  const inputClass =
    "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-[13px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500";
  const selectClass =
    "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-[13px] text-slate-200 outline-none focus:border-blue-500";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !make.trim() ||
      !model.trim() ||
      !serial.trim() ||
      !caliber.trim() ||
      !firearmType.trim()
    ) {
      setError("Make, model, serial number, caliber, and firearm type are required.");
      return;
    }

    if (!proofOwnership || !policyAcknowledged) {
      setError(
        "Proof-of-ownership confirmation and policy acknowledgment are required.",
      );
      return;
    }

    onSubmit({
      make: make.trim(),
      model: model.trim(),
      firearmType: firearmType.trim(),
      serial: serial.trim().toUpperCase(),
      caliber: caliber.trim(),
      capacity: capacity.trim(),
      optic: optic.trim(),
      weaponLight: weaponLight.trim(),
      holster: holster.trim(),
      proofOwnership,
      qualificationReviewed,
      inspectionReviewed,
      policyAcknowledged,
      officerNotes: officerNotes.trim(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 p-0 backdrop-blur-sm sm:p-4">
      <form
        onSubmit={handleSubmit}
        className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-slate-800 bg-slate-950 shadow-2xl sm:rounded-2xl sm:border"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-4 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-400">
              Officer Portal
            </p>
            <h2 className="mt-1 text-xl font-bold text-white">
              {initialRecord ? "Correct & Resubmit Request" : "Submit Off-Duty Firearm Request"}
            </h2>
            <p className="mt-1 text-[12px] text-slate-400">
              {initialRecord
                ? `${initialRecord.officer} ? ${initialRecord.unit}`
                : "Current Officer"}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close request form"
            className="rounded-xl border border-slate-800 p-2 text-slate-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="rounded-2xl border border-red-500/25 bg-red-500/[0.08] p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert size={18} className="mt-0.5 flex-shrink-0 text-red-300" />
              <div>
                <p className="text-[13px] font-semibold text-red-200">
                  Not authorized until approved
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-red-300/80">
                  Submission of this request does not authorize off-duty carry.
                  Written approval must be issued by the Chief of Police.
                </p>
              </div>
            </div>
          </div>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="mb-4 flex items-center gap-2 text-[14px] font-semibold text-white">
              <Crosshair size={16} className="text-blue-400" />
              Firearm Details
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Make *" className={inputClass} />
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model *" className={inputClass} />
              <input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Serial Number *" className={inputClass} />
              <input value={caliber} onChange={(e) => setCaliber(e.target.value)} placeholder="Caliber *" className={inputClass} />

              <select
                value={firearmType}
                onChange={(e) => setFirearmType(e.target.value)}
                className={selectClass}
              >
                <option>Semi-Automatic Pistol</option>
                <option>Revolver</option>
                <option>Other</option>
              </select>

              <input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Magazine Capacity" className={inputClass} />
              <input value={optic} onChange={(e) => setOptic(e.target.value)} placeholder="Optic / Sights" className={inputClass} />
              <input value={weaponLight} onChange={(e) => setWeaponLight(e.target.value)} placeholder="Weapon Light" className={inputClass} />
            </div>

            <input
              value={holster}
              onChange={(e) => setHolster(e.target.value)}
              placeholder="Approved holster make/model"
              className={`${inputClass} mt-3`}
            />

            <textarea
              value={officerNotes}
              onChange={(e) => setOfficerNotes(e.target.value)}
              placeholder="Officer notes, accessories, special considerations, or requested conditions..."
              rows={3}
              className={`${inputClass} mt-3 resize-none`}
            />
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="mb-4 flex items-center gap-2 text-[14px] font-semibold text-white">
              <FileCheck size={16} className="text-blue-400" />
              Required Confirmations
            </div>

            <div className="space-y-2">
              {[
                {
                  label: "I confirm proof of ownership is available.",
                  value: proofOwnership,
                  onChange: setProofOwnership,
                  required: true,
                },
                {
                  label: "I reviewed the qualification requirement.",
                  value: qualificationReviewed,
                  onChange: setQualificationReviewed,
                  required: false,
                },
                {
                  label: "I reviewed the inspection requirement.",
                  value: inspectionReviewed,
                  onChange: setInspectionReviewed,
                  required: false,
                },
                {
                  label:
                    "I acknowledge the off-duty firearm policy and understand approval is required before carry.",
                  value: policyAcknowledged,
                  onChange: setPolicyAcknowledged,
                  required: true,
                },
              ].map((item) => (
                <label
                  key={item.label}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3 text-[12px] text-slate-300"
                >
                  <input
                    type="checkbox"
                    checked={item.value}
                    onChange={(event) => item.onChange(event.target.checked)}
                    className="mt-0.5 accent-blue-500"
                  />
                  <span>
                    {item.label}
                    {item.required && <span className="ml-1 text-red-300">*</span>}
                  </span>
                </label>
              ))}
            </div>
          </section>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-800 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>

          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500"
          >
            <Send size={15} />
            {initialRecord ? "Resubmit for Review" : "Submit to Chief"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review / detail drawer
// ---------------------------------------------------------------------------

function ReviewDrawer({
  record,
  reviewMode,
  canManageInspections,
  onClose,
  onDecision,
  onInspectionRecorded,
}: {
  record: OffDutyFirearm;
  reviewMode: boolean;
  canManageInspections: boolean;
  onClose: () => void;
  onDecision: (
    action: "Approve" | "Deny" | "Return",
    notes: string,
    effectiveDate: string,
    expirationDate: string,
    qualificationOverride: boolean,
    qualificationOverrideReason: string,
  ) => void;
  onInspectionRecorded: () => Promise<void>;

}) {
  const [notes, setNotes] = useState(record.decisionNotes ?? "");
  const [effectiveDate, setEffectiveDate] = useState(
    record.approvalDate ?? todayInputValue(),
  );
  const [expirationDate, setExpirationDate] = useState(
    record.approvalExpires ?? oneYearFromTodayInputValue(),
  );
  const [error, setError] = useState("");
  const [qualificationOverride, setQualificationOverride] = useState(false);
  const [qualificationOverrideReason, setQualificationOverrideReason] =
    useState("");

  const [inspectionDate, setInspectionDate] = useState(
    todayInputValue(),
  );
  const [inspectionResult, setInspectionResult] =
    useState<"Pass" | "Fail">("Pass");
  const [inspectionNotes, setInspectionNotes] = useState("");
  const [inspectionSaving, setInspectionSaving] = useState(false);
  const [inspectionError, setInspectionError] = useState("");
  const [inspectionHistory, setInspectionHistory] = useState<
    OffDutyInspectionHistoryItem[]
  >([]);
  const [inspectionHistoryLoading, setInspectionHistoryLoading] =
    useState(false);
  const [inspectionHistoryError, setInspectionHistoryError] =
    useState("");

  async function loadInspectionHistory() {
    setInspectionHistoryLoading(true);
    setInspectionHistoryError("");

    try {
      const response = await fetch(
        `/api/off-duty-firearms/${record.id}/inspections`,
        { cache: "no-store" },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        inspections?: OffDutyInspectionHistoryItem[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error ||
            "Inspection history could not be loaded.",
        );
      }

      setInspectionHistory(payload.inspections ?? []);
    } catch (historyError) {
      setInspectionHistoryError(
        historyError instanceof Error
          ? historyError.message
          : "Inspection history could not be loaded.",
      );
    } finally {
      setInspectionHistoryLoading(false);
    }
  }

  useEffect(() => {
    void loadInspectionHistory();
  }, [record.id]);

  async function recordInspection() {
    if (!inspectionDate) {
      setInspectionError("Inspection date is required.");
      return;
    }

    setInspectionSaving(true);
    setInspectionError("");

    try {
      const response = await fetch(
        `/api/off-duty-firearms/${record.id}/inspections`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inspectionDate,
            result: inspectionResult,
            notes: inspectionNotes.trim(),
          }),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error || "The inspection could not be recorded.",
        );
      }

      setInspectionNotes("");
      await Promise.all([
        onInspectionRecorded(),
        loadInspectionHistory(),
      ]);
    } catch (inspectionSubmitError) {
      setInspectionError(
        inspectionSubmitError instanceof Error
          ? inspectionSubmitError.message
          : "The inspection could not be recorded.",
      );
    } finally {
      setInspectionSaving(false);
    }
  }

  function submitDecision(action: "Approve" | "Deny" | "Return") {
    if (action === "Approve" && (!effectiveDate || !expirationDate)) {
      setError("Effective and expiration dates are required for approval.");
      return;
    }

    if (
      action === "Approve" &&
      qualificationOverride &&
      !qualificationOverrideReason.trim()
    ) {
      setError(
        "A reason is required when an independent qualification is not required per department policy.",
      );
      return;
    }

    if ((action === "Deny" || action === "Return") && !notes.trim()) {
      setError(
        "Decision notes are required when denying or returning a request.",
      );
      return;
    }

    setError("");

    onDecision(
      action,
      notes.trim(),
      effectiveDate,
      expirationDate,
      qualificationOverride,
      qualificationOverrideReason.trim(),
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 p-0 backdrop-blur-sm sm:p-4">
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden border-slate-800 bg-slate-950 shadow-2xl sm:rounded-2xl sm:border">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-4 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-400">
              {reviewMode ? "Chief Review" : "Request Details"}
            </p>
            <h2 className="mt-1 text-xl font-bold text-white">
              {getFirearmLabel(record)}
            </h2>
            <p className="mt-1 text-[12px] text-slate-400">
              {record.officer} ? {record.unit}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="rounded-xl border border-slate-800 p-2 text-slate-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="flex flex-wrap gap-2">
            <StatusBadge value={record.requestStatus} />
            <StatusBadge value={record.authorizationStatus} />
            <StatusBadge value={record.inspectionStatus} />
          </div>

          {record.authorizationStatus !== "Authorized" && (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/[0.08] p-4">
              <p className="text-[13px] font-semibold text-red-200">
                This firearm is not authorized for off-duty carry.
              </p>
            </div>
          )}

          <section className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:grid-cols-2">
            {[
              ["Make / Model", getFirearmLabel(record)],
              ["Serial Number", record.serial],
              ["Caliber", record.caliber],
              ["Firearm Type", record.firearmType],
              ["Capacity", record.capacity || "Not entered"],
              ["Holster", record.holster || "Not entered"],
              ["Optic", record.optic || "None entered"],
              ["Weapon Light", record.weaponLight || "None entered"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">
                  {label}
                </p>
                <p className="mt-1 text-[12px] text-slate-200">{value}</p>
              </div>
            ))}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-white">
              <ClipboardCheck size={15} className="text-blue-400" />
              Documentation & Policy
            </h3>

            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ["Proof of ownership", record.proofOwnership],
                ["Qualification reviewed", record.qualificationReviewed],
                ["Inspection reviewed", record.inspectionReviewed],
                ["Policy acknowledged", record.policyAcknowledged],
              ].map(([label, complete]) => (
                <div
                  key={String(label)}
                  className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-[12px] text-slate-300"
                >
                  {complete ? (
                    <CheckCircle2 size={14} className="text-emerald-400" />
                  ) : (
                    <XCircle size={14} className="text-red-400" />
                  )}
                  {String(label)}
                </div>
              ))}
            </div>

            <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">
                Qualification Readiness
              </p>

              <div className="mt-2 flex items-center gap-2">
                {["Current", "Due Soon"].includes(
                  record.qualificationStatus,
                ) ? (
                  <CheckCircle2 size={14} className="text-emerald-400" />
                ) : (
                  <XCircle size={14} className="text-red-400" />
                )}

                <p className="text-[12px] font-semibold text-slate-200">
                  {record.qualificationStatus}
                </p>
              </div>

              <p className="mt-1 text-[11px] text-slate-500">
                {record.qualificationReason}
              </p>
            </div>

            <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">
                Officer Notes
              </p>
              <p className="mt-1 text-[12px] text-slate-300">
                {record.officerNotes || "No officer notes entered."}
              </p>
            </div>
          </section>          {canManageInspections && (
            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-white">
                <ClipboardCheck size={15} className="text-blue-400" />
                Record Inspection
              </h3>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-600">
                    Inspection Date
                  </label>
                  <input
                    type="date"
                    value={inspectionDate}
                    onChange={(event) =>
                      setInspectionDate(event.target.value)
                    }
                    style={{ colorScheme: "dark" }}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-[13px] text-white"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-600">
                    Result
                  </label>
                  <select
                    value={inspectionResult}
                    onChange={(event) =>
                      setInspectionResult(
                        event.target.value as "Pass" | "Fail",
                      )
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-[13px] text-white"
                  >
                    <option value="Pass">Pass</option>
                    <option value="Fail">Fail</option>
                  </select>
                </div>
              </div>

              <textarea
                value={inspectionNotes}
                onChange={(event) =>
                  setInspectionNotes(event.target.value)
                }
                placeholder="Inspection findings or notes..."
                rows={3}
                className="mt-3 w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-[13px] text-white outline-none focus:border-blue-500"
              />

              {inspectionError && (
                <p className="mt-2 text-[11px] text-red-300">
                  {inspectionError}
                </p>
              )}

              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-[11px] text-slate-500">
                  Current status: {record.inspectionStatus}
                </p>

                <button
                  type="button"
                  disabled={inspectionSaving}
                  onClick={recordInspection}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-[12px] font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ClipboardCheck size={14} />
                  {inspectionSaving ? "Saving..." : "Record Inspection"}
                </button>
              </div>
            </section>
          )}



          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-white">
              <ClipboardCheck size={15} className="text-blue-400" />
              Inspection History
            </h3>

            {inspectionHistoryLoading ? (
              <p className="text-[12px] text-slate-500">
                Loading inspection history...
              </p>
            ) : inspectionHistoryError ? (
              <p className="text-[12px] text-red-300">
                {inspectionHistoryError}
              </p>
            ) : inspectionHistory.length === 0 ? (
              <p className="text-[12px] text-slate-500">
                No inspections have been recorded.
              </p>
            ) : (
              <div className="space-y-2">
                {inspectionHistory.map((inspection) => (
                  <div
                    key={inspection.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {inspection.result === "Pass" ? (
                          <CheckCircle2 size={14} className="text-emerald-400" />
                        ) : (
                          <XCircle size={14} className="text-red-400" />
                        )}
                        <span className="text-[12px] font-semibold text-slate-200">
                          {inspection.result}
                        </span>
                      </div>

                      <span className="text-[11px] text-slate-500">
                        {inspection.inspectionDate}
                      </span>
                    </div>

                    <div className="mt-2 grid gap-1 text-[11px] text-slate-400 sm:grid-cols-2">
                      <span>Inspected by: {inspection.inspectedBy}</span>
                      <span className="sm:text-right">
                        Recorded: {new Date(inspection.createdAt).toLocaleString()}
                      </span>
                    </div>

                    {inspection.notes && (
                      <p className="mt-2 text-[12px] text-slate-300">
                        {inspection.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {reviewMode && record.requestStatus === "Pending Command Review" && (
            <section className="rounded-2xl border border-blue-500/30 bg-blue-500/[0.05] p-4">
              <h3 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-white">
                <UserCheck size={15} className="text-blue-400" />
                Chief Decision
              </h3>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-600">
                    Effective Date
                  </label>
                  <input
                    type="date"
                    value={effectiveDate}
                    onChange={(event) => setEffectiveDate(event.target.value)}
                    style={{ colorScheme: "dark" }}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-[13px] text-white"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-600">
                    Expiration Date
                  </label>
                  <input
                    type="date"
                    value={expirationDate}
                    onChange={(event) => setExpirationDate(event.target.value)}
                    style={{ colorScheme: "dark" }}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-[13px] text-white"
                  />
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Qualification Requirement
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  Determine whether this firearm requires an independent qualification
                  under department policy.
                </p>

                <div className="mt-3 space-y-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800 px-3 py-3 hover:border-slate-700">
                    <input
                      type="radio"
                      name="qualificationRequirement"
                      checked={!qualificationOverride}
                      onChange={() => {
                        setQualificationOverride(false);
                        setQualificationOverrideReason("");
                        setError("");
                      }}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-[12px] font-semibold text-slate-200">
                        Independent qualification required
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        TracePoint will require a current qualifying record before approval.
                      </p>
                    </div>
                  </label>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800 px-3 py-3 hover:border-slate-700">
                    <input
                      type="radio"
                      name="qualificationRequirement"
                      checked={qualificationOverride}
                      onChange={() => {
                        setQualificationOverride(true);
                        setError("");
                      }}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-[12px] font-semibold text-slate-200">
                        Independent qualification not required per department policy
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        The approving authority is documenting that this firearm does not
                        require its own qualification record.
                      </p>
                    </div>
                  </label>
                </div>

                {qualificationOverride && (
                  <div className="mt-3">
                    <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-600">
                      Policy Exception / Justification
                    </label>
                    <textarea
                      value={qualificationOverrideReason}
                      onChange={(event) =>
                        setQualificationOverrideReason(event.target.value)
                      }
                      placeholder="Explain why an independent qualification is not required..."
                      rows={2}
                      className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-[13px] text-white outline-none focus:border-blue-500"
                    />
                  </div>
                )}
              </div>

              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Approval conditions, denial reason, or corrections required..."
                rows={3}
                className="mt-3 w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-[13px] text-white outline-none focus:border-blue-500"
              />

              {error && (
                <p className="mt-2 text-[11px] text-red-300">{error}</p>
              )}

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => submitDecision("Return")}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-[12px] font-semibold text-amber-300"
                >
                  <RotateCcw size={14} />
                  Return
                </button>

                <button
                  type="button"
                  onClick={() => submitDecision("Deny")}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-[12px] font-semibold text-red-300"
                >
                  <XCircle size={14} />
                  Deny
                </button>

                <button
                  type="button"
                  onClick={() => submitDecision("Approve")}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-[12px] font-semibold text-white hover:bg-emerald-500"
                >
                  <CheckCircle2 size={14} />
                  Approve
                </button>
              </div>
            </section>
          )}

          {record.reviewedBy && (
            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <h3 className="text-[14px] font-semibold text-white">Decision</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-slate-600">
                    Reviewed By
                  </p>
                  <p className="mt-1 text-[12px] text-slate-300">
                    {record.reviewedBy}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-slate-600">
                    Reviewed
                  </p>
                  <p className="mt-1 text-[12px] text-slate-300">
                    {formatDateTime(record.reviewedAt ?? "")}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-slate-600">
                    Effective
                  </p>
                  <p className="mt-1 text-[12px] text-slate-300">
                    {formatDate(record.approvalDate)}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-slate-600">
                    Expires
                  </p>
                  <p className="mt-1 text-[12px] text-slate-300">
                    {formatDate(record.approvalExpires)}
                  </p>
                </div>
              </div>
              <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3 text-[12px] text-slate-300">
                {record.decisionNotes || "No decision notes entered."}
              </p>
            </section>
          )}

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-white">
              <History size={15} className="text-blue-400" />
              Approval History
            </h3>

            <div className="space-y-3">
              {[...record.auditTrail]
                .sort(
                  (a, b) =>
                    new Date(b.timestamp).getTime() -
                    new Date(a.timestamp).getTime(),
                )
                .map((event) => (
                  <div
                    key={event.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[12px] font-semibold text-white">
                        {event.action}
                      </p>
                      <p className="text-[10px] text-slate-600">
                        {formatDateTime(event.timestamp)}
                      </p>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {event.actor} ? {event.actorRole}
                    </p>
                    {event.notes && (
                      <p className="mt-2 text-[11px] text-slate-300">
                        {event.notes}
                      </p>
                    )}
                  </div>
                ))}
            </div>
          </section>
        </div>

        <div className="border-t border-slate-800 px-4 py-4 text-right sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-5 py-2.5 text-[12px] font-semibold text-slate-300 hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function OffDutyFirearmsPage() {
  const [records, setRecords] = useState<OffDutyFirearm[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [canReview, setCanReview] = useState(false);
  const [canManageInspections, setCanManageInspections] =
    useState(false);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [portalMode, setPortalMode] = useState<PortalMode>("Officer Portal");
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<OffDutyTab>("All Records");
  const [requestDrawerOpen, setRequestDrawerOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<OffDutyFirearm | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  async function loadOffDutyRequests() {
    setLoading(true);
    setPageError("");

    try {
      const response = await fetch("/api/off-duty-firearms", {
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => ({}))) as {
        records?: OffDutyFirearm[];
        currentUser?: {
          id?: string;
        };
        canReview?: boolean;
        canManageInspections?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error || "Off-duty firearm requests could not be loaded.",
        );
      }

      setRecords(Array.isArray(payload.records) ? payload.records : []);
      setCurrentUserId(payload.currentUser?.id ?? "");
      setCanReview(payload.canReview === true);
      setCanManageInspections(
        payload.canManageInspections === true,
      );

      if (
        payload.canReview !== true &&
        payload.canManageInspections !== true
      ) {
        setPortalMode("Officer Portal");
        setActiveTab("All Records");
      }
    } catch (error) {
      setRecords([]);
      setPageError(
        error instanceof Error
          ? error.message
          : "Off-duty firearm requests could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOffDutyRequests();
  }, []);

  const visibleBaseRecords = useMemo(
    () =>
      portalMode === "Officer Portal"
        ? records.filter((record) => record.officerId === currentUserId)
        : records,
    [portalMode, records, currentUserId],
  );

  const filteredRecords = useMemo(() => {
    const q = query.trim().toLowerCase();

    return visibleBaseRecords.filter((record) => {
      const haystack = [
        record.officer,
        record.badge,
        record.unit,
        getFirearmLabel(record),
        record.serial,
        record.caliber,
        record.requestStatus,
        record.authorizationStatus,
        record.inspectionStatus,
        record.compliance,
      ]
        .join(" ")
        .toLowerCase();

      return (!q || haystack.includes(q)) && matchesTab(record, activeTab);
    });
  }, [visibleBaseRecords, query, activeTab]);

  const selectedRecord = selectedRecordId
    ? records.find((record) => record.id === selectedRecordId) ?? null
    : null;

  const kpis =
    portalMode === "Department View"
      ? [
          {
            label: "Authorized",
            value: records.filter(
              (record) => record.authorizationStatus === "Authorized",
            ).length,
            icon: ShieldCheck,
            color: "text-emerald-300",
            sub: "Approved firearms",
          },
          {
            label: "Pending",
            value: records.filter(
              (record) => record.requestStatus === "Pending Command Review",
            ).length,
            icon: Clock,
            color: "text-amber-300",
            sub: "Chief review queue",
          },
          {
            label: "Expiring",
            value: records.filter(
              (record) => record.authorizationStatus === "Expiring Soon",
            ).length,
            icon: AlertTriangle,
            color: "text-amber-300",
            sub: "Approval window",
          },
          {
            label: "Needs Action",
            value: records.filter(
              (record) =>
                record.compliance !== "Authorized" ||
                record.inspectionStatus !== "Current",
            ).length,
            icon: ShieldAlert,
            color: "text-red-300",
            sub: "Risk or compliance issue",
          },
        ]
      : [
          {
            label: "My Requests",
            value: visibleBaseRecords.length,
            icon: FileCheck,
            color: "text-blue-300",
            sub: "Submitted firearms",
          },
          {
            label: "Authorized",
            value: visibleBaseRecords.filter(
              (record) => record.authorizationStatus === "Authorized",
            ).length,
            icon: ShieldCheck,
            color: "text-emerald-300",
            sub: "Approved to carry",
          },
          {
            label: "Pending",
            value: visibleBaseRecords.filter(
              (record) => record.requestStatus === "Pending Command Review",
            ).length,
            icon: Clock,
            color: "text-amber-300",
            sub: "Awaiting Chief review",
          },
          {
            label: "Needs Action",
            value: visibleBaseRecords.filter(
              (record) =>
                record.requestStatus === "Returned for Correction" ||
                record.requestStatus === "Denied",
            ).length,
            icon: AlertTriangle,
            color: "text-red-300",
            sub: "Correction or denial",
          },
        ];

  async function handleSubmitRequest(data: RequestFormData) {
    setPageError("");

    try {
      const isResubmission = Boolean(editingRecord);

      const response = await fetch(
        isResubmission
          ? `/api/off-duty-firearms/${editingRecord!.id}`
          : "/api/off-duty-firearms",
        {
          method: isResubmission ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            isResubmission
              ? {
                  action: "Resubmit",
                  ...data,
                }
              : data,
          ),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error ||
            (isResubmission
              ? "The request could not be resubmitted."
              : "The request could not be submitted."),
        );
      }

      setEditingRecord(null);
      setRequestDrawerOpen(false);
      setActiveTab("All Records");

      await loadOffDutyRequests();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The off-duty firearm request could not be saved.";

      setPageError(message);
      window.alert(message);
    }
  }

  async function handleDecision(
    action: "Approve" | "Deny" | "Return",
    notes: string,
    effectiveDate: string,
    expirationDate: string,
    qualificationOverride: boolean,
    qualificationOverrideReason: string,
  ) {
    if (!selectedRecord) return;

    setPageError("");

    try {
      const response = await fetch(
        `/api/off-duty-firearms/${selectedRecord.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action,
            notes,
            effectiveDate,
            expirationDate,
            qualificationOverride,
            qualificationOverrideReason,
          }),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error || "The command decision could not be saved.",
        );
      }

      setSelectedRecordId(null);

      await loadOffDutyRequests();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The command decision could not be saved.";

      setPageError(message);
      window.alert(message);
    }
  }

  function openCorrection(record: OffDutyFirearm) {
    setEditingRecord(record);
    setRequestDrawerOpen(true);
  }


  return (
    <TracePointShell activePage="Off-Duty Firearms">
      {requestDrawerOpen && (
        <RequestDrawer
          initialRecord={editingRecord}
          onClose={() => {
            setEditingRecord(null);
            setRequestDrawerOpen(false);
          }}
          onSubmit={handleSubmitRequest}
        />
      )}

      {selectedRecord && (
        <ReviewDrawer
          record={selectedRecord}
          reviewMode={portalMode === "Department View" && canReview}
          canManageInspections={canManageInspections}
          onClose={() => setSelectedRecordId(null)}
          onDecision={handleDecision}
          onInspectionRecorded={loadOffDutyRequests}
        />
      )}

      {loading && (
        <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-400">
          Loading off-duty firearm records...
        </div>
      )}

      {pageError && (
        <div className="mb-4 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {pageError}
        </div>
      )}

      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h1 className="text-[22px] font-bold text-white">
                Off-Duty Firearms
              </h1>
              <p className="mt-1 max-w-3xl text-[12px] text-slate-500">
                Officer submission, command authorization, inspection,
                qualification, and policy compliance workflow.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              {(canReview || canManageInspections) && (
                <div className="grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-950/50 p-1">
                {(["Officer Portal", "Department View"] as PortalMode[]).map(
                  (mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setPortalMode(mode);
                        setActiveTab(
                          mode === "Department View"
                            ? "Pending Approvals"
                            : "All Records",
                        );
                        setQuery("");
                      }}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold transition ${
                        portalMode === mode
                          ? "bg-blue-600 text-white"
                          : "text-slate-500 hover:text-slate-200"
                      }`}
                    >
                      {mode === "Officer Portal" ? (
                        "My Requests"
                      ) : (
                        <>
                          <span>Department Review</span>
                          {records.filter(
                            (record) =>
                              record.requestStatus === "Pending Command Review",
                          ).length > 0 && (
                            <span
                              className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                                portalMode === mode
                                  ? "bg-white/20 text-white"
                                  : "bg-blue-500/15 text-blue-300"
                              }`}
                            >
                              {
                                records.filter(
                                  (record) =>
                                    record.requestStatus ===
                                    "Pending Command Review",
                                ).length
                              }
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  ),
                )}
              </div>
              )}

              {portalMode === "Officer Portal" && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingRecord(null);
                    setRequestDrawerOpen(true);
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-500"
                >
                  <Plus size={14} />
                  Submit New Request
                </button>
              )}
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} />
          ))}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
          <p className="text-[11px] leading-relaxed text-slate-500">
            Notifications generated by submissions and command decisions are saved
            for TracePoint officer and command workflows. This page remains the
            module workspace for requests, approvals, corrections, and authorization
            history.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-1.5">
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-5">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-xl px-3 py-2.5 text-[12px] font-medium transition ${
                  activeTab === tab
                    ? "bg-blue-600/90 text-white"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-xl">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search officer, firearm, serial, or status..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950/60 py-2.5 pl-9 pr-3 text-[13px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500/60"
              />
            </div>

            <div className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-[12px] text-slate-500">
              <CircleDot size={12} />
              {filteredRecords.length} records
            </div>
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {filteredRecords.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-12 text-center text-[13px] text-slate-600 lg:col-span-2 2xl:col-span-3">
              No off-duty firearm records match this view.
            </div>
          ) : (
            filteredRecords.map((record) => (
              <article
                key={record.id}
                className="rounded-3xl border border-slate-800 bg-slate-900 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-semibold text-slate-400">
                      {getInitials(record.officer)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-[14px] font-semibold text-white">
                        {record.officer}
                      </h3>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {record.badge} ? {record.unit}
                      </p>
                    </div>
                  </div>
                  <StatusBadge value={record.requestStatus} />
                </div>

                <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">
                    Firearm
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <p className="text-[13px] font-semibold text-slate-200">
                      {getFirearmLabel(record)}
                    </p>
                    <p className="font-mono text-[10px] text-slate-500">
                      {record.serial}
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {record.caliber} ? {record.firearmType}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusBadge value={record.authorizationStatus} />
                  <StatusBadge value={record.inspectionStatus} />
                  <StatusBadge value={record.compliance} />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2">
                    <p className="text-[9px] uppercase tracking-widest text-slate-600">
                      Submitted
                    </p>
                    <p className="mt-1 text-[11px] text-slate-300">
                      {formatDate(record.submittedAt)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2">
                    <p className="text-[9px] uppercase tracking-widest text-slate-600">
                      Approval Expires
                    </p>
                    <p className="mt-1 text-[11px] text-slate-300">
                      {formatDate(record.approvalExpires)}
                    </p>
                  </div>
                </div>

                {record.authorizationStatus !== "Authorized" && (
                  <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-[11px] text-red-300">
                    Not authorized for off-duty carry.
                  </div>
                )}

                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setSelectedRecordId(record.id)}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-[11px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
                  >
                    {portalMode === "Department View" &&
                    canReview &&
                    record.requestStatus === "Pending Command Review"
                      ? "Review Request"
                      : "View Details"}
                    <ChevronRight size={13} />
                  </button>

                  {portalMode === "Officer Portal" &&
                    record.requestStatus === "Returned for Correction" && (
                      <button
                        type="button"
                        onClick={() => openCorrection(record)}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-amber-500"
                      >
                        <RotateCcw size={13} />
                        Correct & Resubmit
                      </button>
                    )}
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </TracePointShell>
  );
}













