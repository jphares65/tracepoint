"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  ShieldAlert,
  Target,
  UserCheck,
  Users,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";
import {
  buildRemediationFromAlert,
  cloneRemediations,
  cloneTrainingAlerts,
  REMEDIATIONS_STORAGE_KEY,
  TRAINING_ALERTS_STORAGE_KEY,
  type RemediationRecord,
  type RemediationStatus,
  type TrainingAlert,
  type TrainingAlertSeverity,
  type TrainingAlertStatus,
} from "@/lib/tracepoint/training-alerts";

type ActiveView = "alerts" | "remediations";

function loadStoredRecords<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;

    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getSeverityClasses(severity: TrainingAlertSeverity) {
  if (severity === "High") {
    return "border-red-500/30 bg-red-500/[0.08] text-red-200";
  }

  if (severity === "Medium") {
    return "border-amber-500/30 bg-amber-500/[0.08] text-amber-200";
  }

  return "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200";
}

function getStatusClasses(status: TrainingAlertStatus | RemediationStatus) {
  if (
    status === "Resolved" ||
    status === "Completed - Successful" ||
    status === "Closed - Administrative"
  ) {
    return "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200";
  }

  if (
    status === "Escalated" ||
    status === "Escalated to Command" ||
    status === "Completed - Additional Training Needed"
  ) {
    return "border-red-500/30 bg-red-500/[0.08] text-red-200";
  }

  if (
    status === "Remediation Assigned" ||
    status === "In Progress" ||
    status === "Scheduled"
  ) {
    return "border-blue-500/30 bg-blue-500/[0.08] text-blue-200";
  }

  if (status === "Acknowledged") {
    return "border-amber-500/30 bg-amber-500/[0.08] text-amber-200";
  }

  return "border-slate-700 bg-slate-800/60 text-slate-300";
}

function Pill({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <span
      className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${className}`}
    >
      {children}
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof BellRing;
}) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
          {label}
        </p>
        <Icon size={17} className="text-blue-400" />
      </div>

      <p className="mt-3 text-3xl font-bold text-white">
        {value}
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        {detail}
      </p>
    </div>
  );
}

export default function TrainingAlertsPage() {
  const [activeView, setActiveView] = useState<ActiveView>("alerts");
  const [loaded, setLoaded] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [alerts, setAlerts] =
    useState<TrainingAlert[]>(cloneTrainingAlerts);
  const [remediations, setRemediations] =
    useState<RemediationRecord[]>(cloneRemediations);

  useEffect(() => {
    setAlerts(
      loadStoredRecords(
        TRAINING_ALERTS_STORAGE_KEY,
        cloneTrainingAlerts(),
      ),
    );
    setRemediations(
      loadStoredRecords(
        REMEDIATIONS_STORAGE_KEY,
        cloneRemediations(),
      ),
    );
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;

    window.localStorage.setItem(
      TRAINING_ALERTS_STORAGE_KEY,
      JSON.stringify(alerts),
    );
  }, [alerts, loaded]);

  useEffect(() => {
    if (!loaded) return;

    window.localStorage.setItem(
      REMEDIATIONS_STORAGE_KEY,
      JSON.stringify(remediations),
    );
  }, [loaded, remediations]);

  const metrics = useMemo(() => {
    const openAlerts = alerts.filter(
      (alert) =>
        alert.status !== "Resolved" &&
        alert.status !== "Dismissed with Reason",
    ).length;

    const highSeverity = alerts.filter(
      (alert) =>
        alert.severity === "High" &&
        alert.status !== "Resolved" &&
        alert.status !== "Dismissed with Reason",
    ).length;

    const activeRemediations = remediations.filter(
      (record) =>
        record.status !== "Completed - Successful" &&
        record.status !== "Closed - Administrative",
    ).length;

    const resolved = alerts.filter(
      (alert) => alert.status === "Resolved",
    ).length;

    return {
      openAlerts,
      highSeverity,
      activeRemediations,
      resolved,
    };
  }, [alerts, remediations]);

  function updateAlertStatus(
    alertId: string,
    status: TrainingAlertStatus,
    auditEntry: string,
  ) {
    setAlerts((current) =>
      current.map((alert) =>
        alert.id === alertId
          ? {
              ...alert,
              status,
              auditLog: [auditEntry, ...alert.auditLog],
            }
          : alert,
      ),
    );
  }

  function createRemediation(alert: TrainingAlert) {
    if (alert.remediationId) {
      setActiveView("remediations");
      return;
    }

    const remediation = buildRemediationFromAlert(alert);

    setRemediations((current) => [remediation, ...current]);

    setAlerts((current) =>
      current.map((item) =>
        item.id === alert.id
          ? {
              ...item,
              status: "Remediation Assigned",
              remediationId: remediation.id,
              auditLog: [
                "Remediation record created from alert.",
                ...item.auditLog,
              ],
            }
          : item,
      ),
    );

    setActiveView("remediations");
  }

  function assignRemediation(recordId: string) {
    setRemediations((current) =>
      current.map((record) =>
        record.id === recordId
          ? {
              ...record,
              assignedInstructor: "Range Master",
              dueDate: "Next scheduled range block",
              status: "Scheduled",
              auditLog: [
                "Remediation assigned to Range Master.",
                ...record.auditLog,
              ],
            }
          : record,
      ),
    );
  }

  function updateRemediationStatus(
    record: RemediationRecord,
    status: RemediationStatus,
  ) {
    const statusAudit = `Remediation status changed to ${status}.`;

    setRemediations((current) =>
      current.map((item) =>
        item.id === record.id
          ? {
              ...item,
              status,
              trainingCompleted:
                status === "Completed - Successful"
                  ? "Targeted remedial training completed and documented."
                  : item.trainingCompleted,
              outcome:
                status === "Completed - Successful"
                  ? "Officer successfully completed remediation."
                  : status === "Completed - Additional Training Needed"
                    ? "Additional training remains required."
                    : status === "Escalated to Command"
                      ? "Matter escalated for command review."
                      : item.outcome,
              commandNotified:
                item.commandNotified || status === "Escalated to Command",
              auditLog: [statusAudit, ...item.auditLog],
            }
          : item,
      ),
    );

    if (status === "Completed - Successful") {
      updateAlertStatus(
        record.linkedAlertId,
        "Resolved",
        "Linked remediation completed successfully; alert resolved.",
      );
    }

    if (status === "Completed - Additional Training Needed") {
      updateAlertStatus(
        record.linkedAlertId,
        "In Progress",
        "Linked remediation requires additional training.",
      );
    }

    if (status === "Escalated to Command") {
      updateAlertStatus(
        record.linkedAlertId,
        "Escalated",
        "Linked remediation escalated to command.",
      );
    }
  }

  function addRemediationNote(recordId: string) {
    const note = noteDrafts[recordId]?.trim();
    if (!note) return;

    setRemediations((current) =>
      current.map((record) =>
        record.id === recordId
          ? {
              ...record,
              notes: [note, ...record.notes],
              auditLog: ["Instructor note added.", ...record.auditLog],
            }
          : record,
      ),
    );

    setNoteDrafts((current) => ({
      ...current,
      [recordId]: "",
    }));
  }

  function resetDemoData() {
    setAlerts(cloneTrainingAlerts());
    setRemediations(cloneRemediations());
    setNoteDrafts({});
    setActiveView("alerts");
  }

  return (
    <TracePointShell activePage="Training Alerts">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">
                Officer Performance Workflow
              </p>
              <h1 className="mt-1 text-[24px] font-bold text-white">
                Training Alerts Inbox
              </h1>
              <p className="mt-1 max-w-4xl text-[12px] leading-6 text-slate-500">
                Surface qualification and drill concerns, route them to the
                right users, create remediation records, track follow-up, and
                preserve the audit trail from concern to resolution.
              </p>
            </div>

            <button
              type="button"
              onClick={resetDemoData}
              className="w-fit rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-slate-300 transition hover:border-blue-500/50 hover:text-white"
            >
              Reset demo workflow
            </button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Open Alerts"
            value={String(metrics.openAlerts)}
            detail="Training concerns not fully resolved"
            icon={BellRing}
          />
          <MetricCard
            label="High Severity"
            value={String(metrics.highSeverity)}
            detail="Items requiring command visibility"
            icon={ShieldAlert}
          />
          <MetricCard
            label="Active Remediations"
            value={String(metrics.activeRemediations)}
            detail="Corrective training records in progress"
            icon={ClipboardCheck}
          />
          <MetricCard
            label="Resolved"
            value={String(metrics.resolved)}
            detail="Alerts closed through documented action"
            icon={CheckCircle2}
          />
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-[17px] font-bold text-white">
                <BellRing size={18} className="text-blue-400" />
                Inbox Workflow
              </h2>
              <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">
                Alerts identify the concern. Remediation records document the
                corrective training plan, completion, outcome, and resolution.
              </p>
            </div>

            <div className="flex rounded-2xl border border-slate-800 bg-slate-950/60 p-1">
              <button
                type="button"
                onClick={() => setActiveView("alerts")}
                className={`rounded-xl px-3 py-2 text-[11px] font-semibold transition ${
                  activeView === "alerts"
                    ? "bg-blue-600/20 text-blue-200"
                    : "text-slate-500 hover:text-slate-200"
                }`}
              >
                Training Alerts
              </button>
              <button
                type="button"
                onClick={() => setActiveView("remediations")}
                className={`rounded-xl px-3 py-2 text-[11px] font-semibold transition ${
                  activeView === "remediations"
                    ? "bg-blue-600/20 text-blue-200"
                    : "text-slate-500 hover:text-slate-200"
                }`}
              >
                Remediations
              </button>
            </div>
          </div>

          {activeView === "alerts" ? (
            <div className="mt-4 space-y-3">
              {alerts.map((alert) => (
                <article
                  key={alert.id}
                  className="rounded-3xl border border-slate-800 bg-slate-950/40 p-4"
                >
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill className={getSeverityClasses(alert.severity)}>
                          {alert.severity}
                        </Pill>
                        <Pill className={getStatusClasses(alert.status)}>
                          {alert.status}
                        </Pill>
                        <Pill className="border-slate-700 bg-slate-800/60 text-slate-300">
                          {alert.source}
                        </Pill>
                      </div>

                      <h3 className="mt-3 text-[16px] font-bold text-white">
                        {alert.title}
                      </h3>
                      <p className="mt-1 text-[12px] font-semibold text-slate-300">
                        {alert.officerName}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {alert.officerAssignment} · {alert.category} · Created{" "}
                        {alert.createdAt}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateAlertStatus(
                            alert.id,
                            "Acknowledged",
                            "Alert acknowledged from inbox.",
                          )
                        }
                        disabled={alert.status !== "New"}
                        className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-slate-300 transition hover:border-blue-500/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Acknowledge
                      </button>

                      <button
                        type="button"
                        onClick={() => createRemediation(alert)}
                        className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[11px] font-semibold text-blue-200 transition hover:border-blue-400/60 hover:bg-blue-500/20"
                      >
                        {alert.remediationId
                          ? "Open Remediation"
                          : "Create Remediation"}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          updateAlertStatus(
                            alert.id,
                            "Resolved",
                            "Alert resolved without additional remediation.",
                          )
                        }
                        className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-2 text-[11px] font-semibold text-emerald-200 transition hover:border-emerald-400/60"
                      >
                        Resolve
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_0.85fr]">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                        Basis
                      </p>
                      <p className="mt-2 text-[12px] leading-6 text-slate-400">
                        {alert.basis}
                      </p>

                      <p className="mt-4 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                        Recommended Action
                      </p>
                      <p className="mt-2 text-[12px] leading-6 text-slate-400">
                        {alert.recommendedAction}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                        Routed To
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {alert.recipients.map((recipient) => (
                          <span
                            key={recipient}
                            className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-[10px] font-semibold text-slate-400"
                          >
                            {recipient}
                          </span>
                        ))}
                      </div>

                      <p className="mt-4 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                        Related Records
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {alert.relatedRecords.map((record) => (
                          <span
                            key={record}
                            className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-[10px] font-semibold text-slate-400"
                          >
                            {record}
                          </span>
                        ))}
                      </div>

                      <p className="mt-4 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                        Audit Trail
                      </p>
                      <ul className="mt-2 space-y-1 text-[11px] leading-5 text-slate-500">
                        {alert.auditLog.slice(0, 3).map((entry, index) => (
                          <li key={`${alert.id}-audit-${index}`}>
                            {entry}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {remediations.length === 0 ? (
                <div className="rounded-3xl border border-slate-800 bg-slate-950/40 p-6 text-center">
                  <FileText
                    size={24}
                    className="mx-auto text-slate-600"
                  />
                  <p className="mt-3 text-[13px] font-semibold text-white">
                    No remediation records yet.
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Create one from a Training Alert to document corrective
                    training.
                  </p>
                </div>
              ) : (
                remediations.map((record) => (
                  <article
                    key={record.id}
                    className="rounded-3xl border border-slate-800 bg-slate-950/40 p-4"
                  >
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Pill className={getSeverityClasses(record.severity)}>
                            {record.severity}
                          </Pill>
                          <Pill className={getStatusClasses(record.status)}>
                            {record.status}
                          </Pill>
                          {record.commandNotified && (
                            <Pill className="border-red-500/30 bg-red-500/[0.08] text-red-200">
                              Command Visible
                            </Pill>
                          )}
                        </div>

                        <h3 className="mt-3 text-[16px] font-bold text-white">
                          {record.officerName}
                        </h3>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {record.officerAssignment} ·{" "}
                          {record.deficiencyCategory}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => assignRemediation(record.id)}
                          className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-slate-300 transition hover:border-blue-500/50 hover:text-white"
                        >
                          Assign
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            updateRemediationStatus(
                              record,
                              "In Progress",
                            )
                          }
                          className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[11px] font-semibold text-blue-200 transition hover:border-blue-400/60 hover:bg-blue-500/20"
                        >
                          Start
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            updateRemediationStatus(
                              record,
                              "Completed - Successful",
                            )
                          }
                          className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-2 text-[11px] font-semibold text-emerald-200 transition hover:border-emerald-400/60"
                        >
                          Complete
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            updateRemediationStatus(
                              record,
                              "Escalated to Command",
                            )
                          }
                          className="rounded-xl border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-[11px] font-semibold text-red-200 transition hover:border-red-400/60"
                        >
                          Escalate
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_0.85fr]">
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                            Remediation Plan
                          </p>
                          <p className="mt-2 text-[12px] leading-6 text-slate-400">
                            {record.remediationPlan}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                            Completion / Outcome
                          </p>
                          <p className="mt-2 text-[12px] leading-6 text-slate-400">
                            {record.trainingCompleted}
                          </p>
                          <p className="mt-2 text-[12px] leading-6 text-slate-400">
                            {record.outcome}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                                Assigned Instructor
                              </p>
                              <p className="mt-2 text-[12px] font-semibold text-slate-300">
                                {record.assignedInstructor}
                              </p>
                            </div>

                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                                Due
                              </p>
                              <p className="mt-2 text-[12px] font-semibold text-slate-300">
                                {record.dueDate}
                              </p>
                            </div>

                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                                Trigger
                              </p>
                              <p className="mt-2 text-[12px] font-semibold text-slate-300">
                                {record.triggerSource}
                              </p>
                            </div>

                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                                Assigned
                              </p>
                              <p className="mt-2 text-[12px] font-semibold text-slate-300">
                                {record.dateAssigned}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                            Instructor Notes
                          </p>

                          <div className="mt-2 space-y-2">
                            {record.notes.map((note, index) => (
                              <p
                                key={`${record.id}-note-${index}`}
                                className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-[11px] leading-5 text-slate-400"
                              >
                                {note}
                              </p>
                            ))}
                          </div>

                          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                            <input
                              type="text"
                              value={noteDrafts[record.id] ?? ""}
                              onChange={(event) =>
                                setNoteDrafts((current) => ({
                                  ...current,
                                  [record.id]: event.target.value,
                                }))
                              }
                              placeholder="Add instructor note..."
                              className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[12px] text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-blue-500/50"
                            />
                            <button
                              type="button"
                              onClick={() => addRemediationNote(record.id)}
                              className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[11px] font-semibold text-blue-200 transition hover:border-blue-400/60 hover:bg-blue-500/20"
                            >
                              Add Note
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                        Remediation Audit Trail
                      </p>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        {record.auditLog.slice(0, 4).map((entry, index) => (
                          <p
                            key={`${record.id}-audit-${index}`}
                            className="flex items-center gap-2 text-[11px] leading-5 text-slate-500"
                          >
                            <Clock3 size={12} className="text-slate-600" />
                            {entry}
                          </p>
                        ))}
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          )}
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
            <h3 className="flex items-center gap-2 text-[14px] font-bold text-white">
              <Target size={16} className="text-blue-400" />
              Alert Trigger
            </h3>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              Qualification failures, missing day/night records, declining
              drill trends, repeated deficiencies, and instructor concerns
              generate inbox items for the right roles.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
            <h3 className="flex items-center gap-2 text-[14px] font-bold text-white">
              <Users size={16} className="text-blue-400" />
              Role Routing
            </h3>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              Alerts route to Range Masters, instructors, training supervisors,
              and command staff based on severity, source, and permission.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
            <h3 className="flex items-center gap-2 text-[14px] font-bold text-white">
              <UserCheck size={16} className="text-blue-400" />
              Resolution Record
            </h3>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              The remediation record documents the plan, instructor notes,
              completed training, outcome, command visibility, and audit trail.
            </p>
          </div>
        </section>
      </div>
    </TracePointShell>
  );
}
