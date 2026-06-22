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
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Clock,
  Crosshair,
  FileCheck,
  History,
  Inbox,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  User,
  UserCheck,
  X,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PortalMode = "Officer Portal" | "Chief Review";

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

type InspectionStatus = "Current" | "Due Soon" | "Overdue";
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
  approvalExpires?: string;
  decisionNotes?: string;
  lastQual: string;
  inspectionStatus: InspectionStatus;
  compliance: ComplianceStatus;
  auditTrail: AuditEvent[];
};

type InboxItem = {
  id: string;
  audience: "Chief" | "Officer";
  officerId?: string;
  title: string;
  message: string;
  createdAt: string;
  relatedRequestId: string;
  status: "Open" | "Resolved";
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
// Constants / mock identities
// ---------------------------------------------------------------------------

const STORAGE_KEY = "tracepoint-off-duty-workflow-v1";
const INBOX_KEY = "tracepoint-inbox-v1";

const CURRENT_OFFICER = {
  id: "officer-martinez",
  name: "Off. Martinez, Karen",
  badge: "#3091",
  unit: "Patrol C",
};

const CHIEF_USER = {
  id: "chief-1",
  name: "Chief Thomas",
  role: "Chief of Police",
};

const TABS: OffDutyTab[] = [
  "All Records",
  "Pending Approvals",
  "Authorized",
  "Expiring / Due",
  "Needs Action",
];

const initialRecords: OffDutyFirearm[] = [
  {
    id: "off-duty-1",
    officerId: "officer-rivera",
    officer: "Sgt. Rivera, Miguel",
    badge: "#1142",
    unit: "Patrol A",
    make: "Glock",
    model: "43X",
    firearmType: "Semi-Automatic Pistol",
    serial: "PX93421",
    caliber: "9mm",
    capacity: "10",
    optic: "None",
    weaponLight: "None",
    holster: "Tenicor Certum 3",
    proofOwnership: true,
    qualificationReviewed: true,
    inspectionReviewed: true,
    policyAcknowledged: true,
    officerNotes: "Primary personally owned off-duty firearm.",
    requestStatus: "Approved",
    authorizationStatus: "Authorized",
    submittedAt: "2026-01-08T14:00:00.000Z",
    reviewedAt: "2026-01-10T15:30:00.000Z",
    reviewedBy: CHIEF_USER.name,
    approvalDate: "2026-01-10",
    approvalExpires: "2027-01-10",
    decisionNotes: "Approved subject to annual qualification and inspection.",
    lastQual: "Mar 18, 2026",
    inspectionStatus: "Current",
    compliance: "Authorized",
    auditTrail: [
      {
        id: "audit-1a",
        action: "Submitted",
        actor: "Sgt. Rivera, Miguel",
        actorRole: "Officer",
        timestamp: "2026-01-08T14:00:00.000Z",
      },
      {
        id: "audit-1b",
        action: "Approved",
        actor: CHIEF_USER.name,
        actorRole: CHIEF_USER.role,
        timestamp: "2026-01-10T15:30:00.000Z",
        notes: "Approved subject to annual qualification and inspection.",
      },
    ],
  },
  {
    id: "off-duty-2",
    officerId: "officer-chen",
    officer: "Off. Chen, David",
    badge: "#3087",
    unit: "Patrol B",
    make: "Sig Sauer",
    model: "P365",
    firearmType: "Semi-Automatic Pistol",
    serial: "365NJ8841",
    caliber: "9mm",
    capacity: "10",
    optic: "RomeoZero",
    weaponLight: "None",
    holster: "Vedder LightTuck",
    proofOwnership: true,
    qualificationReviewed: true,
    inspectionReviewed: true,
    policyAcknowledged: true,
    officerNotes: "",
    requestStatus: "Approved",
    authorizationStatus: "Expiring Soon",
    submittedAt: "2025-05-28T13:00:00.000Z",
    reviewedAt: "2025-06-01T16:00:00.000Z",
    reviewedBy: CHIEF_USER.name,
    approvalDate: "2025-06-01",
    approvalExpires: "2026-07-01",
    decisionNotes: "Approved.",
    lastQual: "Oct 17, 2025",
    inspectionStatus: "Due Soon",
    compliance: "At Risk",
    auditTrail: [
      {
        id: "audit-2a",
        action: "Submitted",
        actor: "Off. Chen, David",
        actorRole: "Officer",
        timestamp: "2025-05-28T13:00:00.000Z",
      },
      {
        id: "audit-2b",
        action: "Approved",
        actor: CHIEF_USER.name,
        actorRole: CHIEF_USER.role,
        timestamp: "2025-06-01T16:00:00.000Z",
      },
    ],
  },
  {
    id: "off-duty-3",
    officerId: "officer-patel",
    officer: "Det. Patel, Arun",
    badge: "#2201",
    unit: "CID",
    make: "Smith & Wesson",
    model: "Shield Plus",
    firearmType: "Semi-Automatic Pistol",
    serial: "SWP7721",
    caliber: "9mm",
    capacity: "13",
    optic: "None",
    weaponLight: "None",
    holster: "Safariland Schema",
    proofOwnership: true,
    qualificationReviewed: true,
    inspectionReviewed: true,
    policyAcknowledged: true,
    officerNotes: "Requesting authorization as secondary off-duty firearm.",
    requestStatus: "Pending Command Review",
    authorizationStatus: "Not Authorized",
    submittedAt: "2026-06-20T18:25:00.000Z",
    lastQual: "Not recorded",
    inspectionStatus: "Due Soon",
    compliance: "At Risk",
    auditTrail: [
      {
        id: "audit-3a",
        action: "Submitted",
        actor: "Det. Patel, Arun",
        actorRole: "Officer",
        timestamp: "2026-06-20T18:25:00.000Z",
        notes: "Submitted for command authorization.",
      },
    ],
  },
  {
    id: "off-duty-4",
    officerId: "officer-torres",
    officer: "Off. Torres, Lucia",
    badge: "#3312",
    unit: "Patrol C",
    make: "Glock",
    model: "48 MOS",
    firearmType: "Semi-Automatic Pistol",
    serial: "G48M2231",
    caliber: "9mm",
    capacity: "10",
    optic: "Holosun 407K",
    weaponLight: "Streamlight TLR-7 Sub",
    holster: "Tier 1 Concealed",
    proofOwnership: true,
    qualificationReviewed: true,
    inspectionReviewed: true,
    policyAcknowledged: true,
    officerNotes: "",
    requestStatus: "Approved",
    authorizationStatus: "Authorized",
    submittedAt: "2026-02-01T16:45:00.000Z",
    reviewedAt: "2026-02-05T15:00:00.000Z",
    reviewedBy: CHIEF_USER.name,
    approvalDate: "2026-02-05",
    approvalExpires: "2027-02-05",
    decisionNotes: "Approved.",
    lastQual: "Mar 20, 2026",
    inspectionStatus: "Current",
    compliance: "Authorized",
    auditTrail: [
      {
        id: "audit-4a",
        action: "Submitted",
        actor: "Off. Torres, Lucia",
        actorRole: "Officer",
        timestamp: "2026-02-01T16:45:00.000Z",
      },
      {
        id: "audit-4b",
        action: "Approved",
        actor: CHIEF_USER.name,
        actorRole: CHIEF_USER.role,
        timestamp: "2026-02-05T15:00:00.000Z",
      },
    ],
  },
];

const initialInbox: InboxItem[] = [
  {
    id: "inbox-chief-patel",
    audience: "Chief",
    title: "Off-Duty Firearm Approval Request",
    message:
      "Det. Patel submitted a Smith & Wesson Shield Plus for off-duty carry authorization.",
    createdAt: "2026-06-20T18:25:00.000Z",
    relatedRequestId: "off-duty-3",
    status: "Open",
  },
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
  if (!value) return "—";

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
              {CURRENT_OFFICER.name} · {CURRENT_OFFICER.badge} ·{" "}
              {CURRENT_OFFICER.unit}
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
  onClose,
  onDecision,
}: {
  record: OffDutyFirearm;
  reviewMode: boolean;
  onClose: () => void;
  onDecision: (
    action: "Approve" | "Deny" | "Return",
    notes: string,
    effectiveDate: string,
    expirationDate: string,
  ) => void;
}) {
  const [notes, setNotes] = useState(record.decisionNotes ?? "");
  const [effectiveDate, setEffectiveDate] = useState(
    record.approvalDate ?? todayInputValue(),
  );
  const [expirationDate, setExpirationDate] = useState(
    record.approvalExpires ?? oneYearFromTodayInputValue(),
  );
  const [error, setError] = useState("");

  function submitDecision(action: "Approve" | "Deny" | "Return") {
    if (action === "Approve" && (!effectiveDate || !expirationDate)) {
      setError("Effective and expiration dates are required for approval.");
      return;
    }

    if ((action === "Deny" || action === "Return") && !notes.trim()) {
      setError("Decision notes are required when denying or returning a request.");
      return;
    }

    onDecision(action, notes.trim(), effectiveDate, expirationDate);
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
              {record.officer} · {record.badge} · {record.unit}
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
                Officer Notes
              </p>
              <p className="mt-1 text-[12px] text-slate-300">
                {record.officerNotes || "No officer notes entered."}
              </p>
            </div>
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
                      {event.actor} · {event.actorRole}
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
  const [records, setRecords] = useState<OffDutyFirearm[]>(initialRecords);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>(initialInbox);
  const [hydrated, setHydrated] = useState(false);
  const [portalMode, setPortalMode] = useState<PortalMode>("Officer Portal");
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<OffDutyTab>("All Records");
  const [requestDrawerOpen, setRequestDrawerOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<OffDutyFirearm | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const storedRecords = window.localStorage.getItem(STORAGE_KEY);
      const storedInbox = window.localStorage.getItem(INBOX_KEY);

      if (storedRecords) {
        const parsedRecords = JSON.parse(storedRecords) as OffDutyFirearm[];
        if (Array.isArray(parsedRecords)) setRecords(parsedRecords);
      }

      if (storedInbox) {
        const parsedInbox = JSON.parse(storedInbox) as InboxItem[];
        if (Array.isArray(parsedInbox)) setInboxItems(parsedInbox);
      }
    } catch (error) {
      console.error("Unable to load off-duty workflow data:", error);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      window.localStorage.setItem(INBOX_KEY, JSON.stringify(inboxItems));
    } catch (error) {
      console.error("Unable to save off-duty workflow data:", error);
    }
  }, [records, inboxItems, hydrated]);

  const visibleBaseRecords = useMemo(
    () =>
      portalMode === "Officer Portal"
        ? records.filter((record) => record.officerId === CURRENT_OFFICER.id)
        : records,
    [portalMode, records],
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

  const openChiefInbox = inboxItems
    .filter((item) => item.audience === "Chief" && item.status === "Open")
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  const officerInbox = inboxItems
    .filter(
      (item) =>
        item.audience === "Officer" &&
        item.officerId === CURRENT_OFFICER.id &&
        item.status === "Open",
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  const kpis =
    portalMode === "Chief Review"
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

  function handleSubmitRequest(data: RequestFormData) {
    const timestamp = nowIso();

    if (editingRecord) {
      setRecords((current) =>
        current.map((record) =>
          record.id === editingRecord.id
            ? {
                ...record,
                ...data,
                requestStatus: "Pending Command Review",
                authorizationStatus: "Not Authorized",
                compliance: "At Risk",
                submittedAt: timestamp,
                reviewedAt: undefined,
                reviewedBy: undefined,
                approvalDate: undefined,
                approvalExpires: undefined,
                decisionNotes: undefined,
                auditTrail: [
                  ...record.auditTrail,
                  {
                    id: `audit-${Date.now()}`,
                    action: "Resubmitted",
                    actor: CURRENT_OFFICER.name,
                    actorRole: "Officer",
                    timestamp,
                    notes: "Corrected request resubmitted for command review.",
                  },
                ],
              }
            : record,
        ),
      );

      setInboxItems((current) => [
        {
          id: `inbox-${Date.now()}`,
          audience: "Chief",
          title: "Corrected Off-Duty Firearm Request",
          message: `${CURRENT_OFFICER.name} resubmitted ${data.make} ${data.model} for command review.`,
          createdAt: timestamp,
          relatedRequestId: editingRecord.id,
          status: "Open",
        },
        ...current.filter(
          (item) =>
            !(
              item.relatedRequestId === editingRecord.id &&
              item.audience === "Chief" &&
              item.status === "Open"
            ),
        ),
      ]);
    } else {
      const requestId = `off-duty-${Date.now()}`;

      const newRecord: OffDutyFirearm = {
        id: requestId,
        officerId: CURRENT_OFFICER.id,
        officer: CURRENT_OFFICER.name,
        badge: CURRENT_OFFICER.badge,
        unit: CURRENT_OFFICER.unit,
        ...data,
        requestStatus: "Pending Command Review",
        authorizationStatus: "Not Authorized",
        submittedAt: timestamp,
        lastQual: "Not recorded",
        inspectionStatus: "Due Soon",
        compliance: "At Risk",
        auditTrail: [
          {
            id: `audit-${Date.now()}`,
            action: "Submitted",
            actor: CURRENT_OFFICER.name,
            actorRole: "Officer",
            timestamp,
            notes: "Submitted for off-duty carry authorization.",
          },
        ],
      };

      setRecords((current) => [newRecord, ...current]);
      setInboxItems((current) => [
        {
          id: `inbox-${Date.now()}`,
          audience: "Chief",
          title: "Off-Duty Firearm Approval Request",
          message: `${CURRENT_OFFICER.name} submitted ${data.make} ${data.model} (${data.serial}) for off-duty carry authorization.`,
          createdAt: timestamp,
          relatedRequestId: requestId,
          status: "Open",
        },
        ...current,
      ]);
    }

    setEditingRecord(null);
    setRequestDrawerOpen(false);
    setActiveTab("All Records");
  }

  function handleDecision(
    action: "Approve" | "Deny" | "Return",
    notes: string,
    effectiveDate: string,
    expirationDate: string,
  ) {
    if (!selectedRecord) return;

    const timestamp = nowIso();

    setRecords((current) =>
      current.map((record) => {
        if (record.id !== selectedRecord.id) return record;

        const common = {
          reviewedAt: timestamp,
          reviewedBy: CHIEF_USER.name,
          decisionNotes: notes,
        };

        if (action === "Approve") {
          return {
            ...record,
            ...common,
            requestStatus: "Approved" as RequestStatus,
            authorizationStatus: "Authorized" as AuthorizationStatus,
            compliance: "Authorized" as ComplianceStatus,
            approvalDate: effectiveDate,
            approvalExpires: expirationDate,
            auditTrail: [
              ...record.auditTrail,
              {
                id: `audit-${Date.now()}`,
                action: "Approved" as AuditAction,
                actor: CHIEF_USER.name,
                actorRole: CHIEF_USER.role,
                timestamp,
                notes: notes || "Approved for off-duty carry.",
              },
            ],
          };
        }

        if (action === "Deny") {
          return {
            ...record,
            ...common,
            requestStatus: "Denied" as RequestStatus,
            authorizationStatus: "Not Authorized" as AuthorizationStatus,
            compliance: "At Risk" as ComplianceStatus,
            approvalDate: undefined,
            approvalExpires: undefined,
            auditTrail: [
              ...record.auditTrail,
              {
                id: `audit-${Date.now()}`,
                action: "Denied" as AuditAction,
                actor: CHIEF_USER.name,
                actorRole: CHIEF_USER.role,
                timestamp,
                notes,
              },
            ],
          };
        }

        return {
          ...record,
          ...common,
          requestStatus: "Returned for Correction" as RequestStatus,
          authorizationStatus: "Not Authorized" as AuthorizationStatus,
          compliance: "At Risk" as ComplianceStatus,
          approvalDate: undefined,
          approvalExpires: undefined,
          auditTrail: [
            ...record.auditTrail,
            {
              id: `audit-${Date.now()}`,
              action: "Returned for Correction" as AuditAction,
              actor: CHIEF_USER.name,
              actorRole: CHIEF_USER.role,
              timestamp,
              notes,
            },
          ],
        };
      }),
    );

    setInboxItems((current) => [
      {
        id: `inbox-${Date.now()}`,
        audience: "Officer",
        officerId: selectedRecord.officerId,
        title:
          action === "Approve"
            ? "Off-Duty Firearm Approved"
            : action === "Deny"
              ? "Off-Duty Firearm Request Denied"
              : "Off-Duty Firearm Request Returned",
        message:
          action === "Approve"
            ? `${getFirearmLabel(selectedRecord)} has been approved for off-duty carry through ${formatDate(expirationDate)}.`
            : `${getFirearmLabel(selectedRecord)}: ${notes}`,
        createdAt: timestamp,
        relatedRequestId: selectedRecord.id,
        status: "Open",
      },
      ...current.map((item) =>
        item.relatedRequestId === selectedRecord.id &&
        item.audience === "Chief"
          ? { ...item, status: "Resolved" as const }
          : item,
      ),
    ]);

    setSelectedRecordId(null);
  }

  function openCorrection(record: OffDutyFirearm) {
    setEditingRecord(record);
    setRequestDrawerOpen(true);
  }

  function markInboxResolved(itemId: string) {
    setInboxItems((current) =>
      current.map((item) =>
        item.id === itemId ? { ...item, status: "Resolved" } : item,
      ),
    );
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
          reviewMode={portalMode === "Chief Review"}
          onClose={() => setSelectedRecordId(null)}
          onDecision={handleDecision}
        />
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
              <div className="grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-950/50 p-1">
                {(["Officer Portal", "Chief Review"] as PortalMode[]).map(
                  (mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setPortalMode(mode);
                        setActiveTab(
                          mode === "Chief Review"
                            ? "Pending Approvals"
                            : "All Records",
                        );
                        setQuery("");
                      }}
                      className={`rounded-lg px-3 py-2 text-[11px] font-semibold transition ${
                        portalMode === mode
                          ? "bg-blue-600 text-white"
                          : "text-slate-500 hover:text-slate-200"
                      }`}
                    >
                      {mode}
                    </button>
                  ),
                )}
              </div>

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

        {portalMode === "Chief Review" && (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-[16px] font-bold text-white">
                  <Inbox size={17} className="text-blue-400" />
                  Chief TracePoint Inbox
                </h2>
                <p className="mt-1 text-[11px] text-slate-500">
                  New off-duty firearm authorization requests requiring command
                  action.
                </p>
              </div>
              <StatusBadge value={`${openChiefInbox.length} Open`} />
            </div>

            {openChiefInbox.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-8 text-center text-[12px] text-slate-600">
                No pending off-duty firearm approvals.
              </div>
            ) : (
              <div className="space-y-2">
                {openChiefInbox.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedRecordId(item.relatedRequestId)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-left hover:border-blue-500/40"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <Bell size={15} className="mt-0.5 flex-shrink-0 text-amber-300" />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-white">
                          {item.title}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {item.message}
                        </p>
                        <p className="mt-1 text-[10px] text-slate-600">
                          {formatDateTime(item.createdAt)}
                        </p>
                      </div>
                    </div>
                    <ChevronRight size={16} className="flex-shrink-0 text-slate-600" />
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {portalMode === "Officer Portal" && (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-[16px] font-bold text-white">
                  <Bell size={17} className="text-blue-400" />
                  My TracePoint Inbox
                </h2>
                <p className="mt-1 text-[11px] text-slate-500">
                  Approval decisions and requests requiring your attention.
                </p>
              </div>
              <StatusBadge value={`${officerInbox.length} Open`} />
            </div>

            {officerInbox.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-7 text-center text-[12px] text-slate-600">
                No new off-duty firearm notifications.
              </div>
            ) : (
              <div className="space-y-2">
                {officerInbox.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-[13px] font-semibold text-white">
                        {item.title}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {item.message}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => markInboxResolved(item.id)}
                      className="rounded-xl border border-slate-700 px-3 py-2 text-[11px] font-semibold text-slate-300 hover:text-white"
                    >
                      Mark Read
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

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
                        {record.badge} · {record.unit}
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
                    {record.caliber} · {record.firearmType}
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
                    {portalMode === "Chief Review" &&
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
