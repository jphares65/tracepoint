"use client";

import {
  Award,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  GraduationCap,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import AgencyTrainingEventEditor, {
  type EditableTrainingEvent,
} from "@/app/components/AgencyTrainingEventEditor";
import AgencyTrainingRosterBoard from "@/app/components/AgencyTrainingRosterBoard";
import TracePointShell from "@/app/components/TracePointShell";

type TrainingStatus =
  | "draft"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

type TrainingEvent = {
  id: string;
  title: string;
  trainingType: string;
  category: string | null;
  description: string | null;
  topics: string[];
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  defaultHours: number | null;
  status: TrainingStatus;
  certificationTypeId: string | null;
  certificationValidDays: number | null;
  certificateEnabled: boolean;
  certificateTitle: string | null;
  lessonPlanRequired: boolean;
  notes: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  attendeeCount: number;
  completedCount: number;
  instructorCount: number;
  leadInstructor: string | null;
};

type EventsPayload = {
  events?: TrainingEvent[];
  canManage?: boolean;
  error?: string;
};

type EventDraft = {
  title: string;
  trainingType: string;
  category: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  defaultHours: string;
  status: TrainingStatus;
  topics: string;
  lessonPlanRequired: boolean;
  certificateEnabled: boolean;
  certificateTitle: string;
};

const EMPTY_DRAFT: EventDraft = {
  title: "",
  trainingType: "In-Service",
  category: "",
  description: "",
  location: "",
  startsAt: "",
  endsAt: "",
  defaultHours: "",
  status: "draft",
  topics: "",
  lessonPlanRequired: false,
  certificateEnabled: false,
  certificateTitle: "",
};

const STATUS_LABELS: Record<TrainingStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_STYLES: Record<TrainingStatus, string> = {
  draft: "border-slate-600 bg-slate-800/70 text-slate-300",
  scheduled: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  in_progress: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  cancelled: "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

function localDateTimeValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function initialDraft(): EventDraft {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

  return {
    ...EMPTY_DRAFT,
    startsAt: localDateTimeValue(start),
    endsAt: localDateTimeValue(end),
  };
}

function formatEventDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatEventTime(startValue: string, endValue: string | null) {
  const start = new Date(startValue);
  const end = endValue ? new Date(endValue) : null;
  if (Number.isNaN(start.getTime())) return "Time unavailable";

  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return end && !Number.isNaN(end.getTime())
    ? `${formatter.format(start)} - ${formatter.format(end)}`
    : formatter.format(start);
}

function StatusPill({ status }: { status: TrainingStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
      {children}
    </span>
  );
}

export default function AgencyTrainingPage() {
  const [events, setEvents] = useState<TrainingEvent[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editorEvent, setEditorEvent] = useState<TrainingEvent | null | undefined>(
    undefined,
  );
  const [activeWorkspace, setActiveWorkspace] = useState<"overview" | "roster">(
    "overview",
  );
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<EventDraft>(() => initialDraft());

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/agency-training/events", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as EventsPayload;

      if (!response.ok) {
        throw new Error(payload.error || "Agency Training could not be loaded.");
      }

      const nextEvents = Array.isArray(payload.events) ? payload.events : [];
      setEvents(nextEvents);
      setCanManage(payload.canManage === true);
      setSelectedEventId((current) =>
        current && nextEvents.some((event) => event.id === current)
          ? current
          : nextEvents[0]?.id ?? "",
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Agency Training could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? events[0],
    [events, selectedEventId],
  );

  const summary = useMemo(
    () => ({
      scheduled: events.filter((event) => event.status === "scheduled").length,
      active: events.filter((event) => event.status === "in_progress").length,
      completed: events.filter((event) => event.status === "completed").length,
      attendees: events.reduce((total, event) => total + event.attendeeCount, 0),
    }),
    [events],
  );

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/agency-training/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          trainingType: draft.trainingType,
          category: draft.category,
          description: draft.description,
          location: draft.location,
          startsAt: draft.startsAt,
          endsAt: draft.endsAt,
          defaultHours: draft.defaultHours,
          status: draft.status,
          topics: draft.topics
            .split(",")
            .map((topic) => topic.trim())
            .filter(Boolean),
          lessonPlanRequired: draft.lessonPlanRequired,
          certificateEnabled: draft.certificateEnabled,
          certificateTitle: draft.certificateTitle,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        event?: TrainingEvent;
        error?: string;
      };

      if (!response.ok || !payload.event) {
        throw new Error(payload.error || "The training event could not be created.");
      }

      setEvents((current) => [payload.event as TrainingEvent, ...current]);
      setSelectedEventId(payload.event.id);
      setDraft(initialDraft());
      setShowCreate(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The training event could not be created.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <TracePointShell activePage="Agency Training">
      <div className="mx-auto w-full max-w-[1500px] space-y-6">
        <section className="overflow-hidden rounded-3xl border border-blue-500/20 bg-slate-900/80">
          <div className="flex flex-col gap-5 px-6 py-7 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-blue-400">
                <GraduationCap size={15} />
                Training Operations
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Agency Training
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Plan the event, assemble the roster, document individual outcomes,
                preserve the training file, and close one complete auditable record.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void loadEvents()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-xs font-bold text-slate-300 transition hover:border-slate-600 hover:text-white"
              >
                <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                Refresh
              </button>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => setEditorEvent(null)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-xs font-bold text-white transition hover:bg-blue-500"
                >
                  <Plus size={16} />
                  Create Event
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Scheduled", summary.scheduled, CalendarDays, "text-blue-300"],
            ["In Progress", summary.active, Clock3, "text-amber-300"],
            ["Completed", summary.completed, CheckCircle2, "text-emerald-300"],
            ["Roster Assignments", summary.attendees, Users, "text-violet-300"],
          ].map(([label, value, Icon, color]) => {
            const MetricIcon = Icon as typeof CalendarDays;
            return (
              <div
                key={String(label)}
                className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
              >
                <MetricIcon size={17} className={String(color)} />
                <p className="mt-3 text-2xl font-bold text-white">{String(value)}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                  {String(label)}
                </p>
              </div>
            );
          })}
        </section>

        {error ? (
          <section className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
            <p className="font-bold">Agency Training needs attention</p>
            <p className="mt-1 text-xs leading-5 text-rose-200/80">{error}</p>
          </section>
        ) : null}

        <section className="grid gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
            <div className="border-b border-slate-800 px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">
                Training Events
              </p>
              <h2 className="mt-1 text-base font-bold text-white">
                Event schedule and history
              </h2>
            </div>

            <div className="max-h-[680px] space-y-2 overflow-y-auto p-3">
              {loading ? (
                <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-slate-500">
                  <Loader2 size={17} className="animate-spin" />
                  Loading training events
                </div>
              ) : events.length === 0 ? (
                <div className="px-5 py-14 text-center">
                  <CalendarDays size={28} className="mx-auto text-slate-600" />
                  <p className="mt-4 text-sm font-bold text-slate-300">
                    No training events yet
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    Create the first event to begin replacing training calendars,
                    rosters, sign-in sheets, and separate spreadsheets.
                  </p>
                </div>
              ) : (
                events.map((event) => {
                  const selected = event.id === selectedEvent?.id;
                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => {
                        setSelectedEventId(event.id);
                        setActiveWorkspace("overview");
                      }}
                      className={`w-full rounded-xl border p-4 text-left transition ${
                        selected
                          ? "border-blue-500/50 bg-blue-500/10"
                          : "border-slate-800 bg-slate-950/35 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-white">
                            {event.title}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {formatEventDate(event.startsAt)}
                          </p>
                        </div>
                        <ChevronRight
                          size={16}
                          className={selected ? "text-blue-300" : "text-slate-600"}
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <StatusPill status={event.status} />
                        <span className="text-[10px] font-semibold text-slate-500">
                          {event.trainingType}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-500">
                          {event.attendeeCount} assigned
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="min-h-[520px] rounded-2xl border border-slate-800 bg-slate-900/70">
            {selectedEvent ? (
              <>
                <div className="border-b border-slate-800 px-6 py-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <StatusPill status={selectedEvent.status} />
                      <h2 className="mt-3 text-xl font-bold text-white">
                        {selectedEvent.title}
                      </h2>
                      <p className="mt-1 text-xs font-semibold text-blue-300">
                        {selectedEvent.trainingType}
                        {selectedEvent.category ? ` / ${selectedEvent.category}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => setEditorEvent(selectedEvent)}
                          className="rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-3 text-xs font-bold text-slate-300 transition hover:border-blue-500/50 hover:text-white"
                        >
                          Edit Event
                        </button>
                      ) : null}
                      <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-right">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">
                          Completion
                        </p>
                        <p className="mt-1 text-lg font-bold text-white">
                          {selectedEvent.completedCount}/{selectedEvent.attendeeCount}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-5 p-6">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      [CalendarDays, "Date", formatEventDate(selectedEvent.startsAt)],
                      [Clock3, "Time", formatEventTime(selectedEvent.startsAt, selectedEvent.endsAt)],
                      [MapPin, "Location", selectedEvent.location || "Not entered"],
                      [Users, "Lead Instructor", selectedEvent.leadInstructor || "Not assigned"],
                    ].map(([Icon, label, value]) => {
                      const DetailIcon = Icon as typeof CalendarDays;
                      return (
                        <div
                          key={String(label)}
                          className="rounded-xl border border-slate-800 bg-slate-950/35 p-4"
                        >
                          <DetailIcon size={15} className="text-blue-300" />
                          <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">
                            {String(label)}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-slate-200">
                            {String(value)}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-5">
                      <div className="flex items-center gap-2">
                        <FileText size={16} className="text-blue-300" />
                        <h3 className="text-sm font-bold text-white">Event record</h3>
                      </div>
                      <p className="mt-3 text-xs leading-6 text-slate-400">
                        {selectedEvent.description ||
                          "Add the course purpose, instructional objectives, and event description."}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {selectedEvent.topics.length > 0 ? (
                          selectedEvent.topics.map((topic) => (
                            <span
                              key={topic}
                              className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-300"
                            >
                              {topic}
                            </span>
                          ))
                        ) : (
                          <span className="text-[11px] text-slate-600">No topics entered</span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-5">
                      <div className="flex items-center gap-2">
                        <Award size={16} className="text-violet-300" />
                        <h3 className="text-sm font-bold text-white">
                          Documentation outcome
                        </h3>
                      </div>
                      <div className="mt-4 space-y-3 text-xs text-slate-400">
                        <div className="flex items-center justify-between gap-3">
                          <span>Default training hours</span>
                          <strong className="text-slate-200">
                            {selectedEvent.defaultHours ?? "Not set"}
                          </strong>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Lesson plan</span>
                          <strong className="text-slate-200">
                            {selectedEvent.lessonPlanRequired ? "Required" : "Optional"}
                          </strong>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Certificates</span>
                          <strong className="text-slate-200">
                            {selectedEvent.certificateEnabled ? "Enabled" : "Not generated"}
                          </strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => setActiveWorkspace("roster")}
                      className={`rounded-xl border p-4 text-left transition hover:border-blue-500/40 hover:bg-blue-500/5 ${
                        activeWorkspace === "roster"
                          ? "border-blue-500/50 bg-blue-500/10"
                          : "border-slate-800 bg-slate-950/35"
                      }`}
                    >
                      <Users size={17} className="text-blue-300" />
                      <p className="mt-3 text-xs font-bold text-white">Roster</p>
                      <p className="mt-1 text-[10px] leading-4 text-slate-500">
                        Assign personnel and instructors
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveWorkspace("roster")}
                      className={`rounded-xl border p-4 text-left transition hover:border-blue-500/40 hover:bg-blue-500/5 ${
                        activeWorkspace === "roster"
                          ? "border-blue-500/50 bg-blue-500/10"
                          : "border-slate-800 bg-slate-950/35"
                      }`}
                    >
                      <ShieldCheck size={17} className="text-blue-300" />
                      <p className="mt-3 text-xs font-bold text-white">Attendance & Results</p>
                      <p className="mt-1 text-[10px] leading-4 text-slate-500">
                        Record hours and outcomes
                      </p>
                    </button>
                    <button
                      type="button"
                      className="rounded-xl border border-slate-800 bg-slate-950/35 p-4 text-left opacity-70"
                      title="Files and certificates are the next build phase"
                    >
                      <Award size={17} className="text-violet-300" />
                      <p className="mt-3 text-xs font-bold text-white">Files & Certificates</p>
                      <p className="mt-1 text-[10px] leading-4 text-slate-500">
                        Preserve the complete training file
                      </p>
                    </button>
                  </div>

                  {activeWorkspace === "roster" ? (
                    <AgencyTrainingRosterBoard
                      key={selectedEvent.id}
                      eventId={selectedEvent.id}
                      defaultHours={selectedEvent.defaultHours}
                      canManage={canManage}
                      onSaved={(attendeeCount, completedCount) =>
                        setEvents((current) =>
                          current.map((event) =>
                            event.id === selectedEvent.id
                              ? { ...event, attendeeCount, completedCount }
                              : event,
                          ),
                        )
                      }
                    />
                  ) : null}
                </div>
              </>
            ) : (
              <div className="flex min-h-[520px] items-center justify-center p-8 text-center">
                <div className="max-w-md">
                  <GraduationCap size={34} className="mx-auto text-blue-400" />
                  <h2 className="mt-4 text-lg font-bold text-white">
                    One complete record for every training event
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Select an event or create the first one to begin building its
                    roster, attendance, lesson plan, outcomes, certificates, and report.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {showCreate ? (
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-4 backdrop-blur-sm sm:p-8">
          <form
            onSubmit={createEvent}
            className="my-auto w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-slate-800 px-6 py-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">
                  New Training Record
                </p>
                <h2 className="mt-1 text-xl font-bold text-white">Create Training Event</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-xl border border-slate-700 p-2 text-slate-400 hover:text-white"
                aria-label="Close create-event form"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-5 p-6 md:grid-cols-2">
              <label className="md:col-span-2">
                <FieldLabel>Event title</FieldLabel>
                <input
                  required
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="Example: Annual Use of Force Refresher"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-semibold text-white outline-none focus:border-blue-500"
                />
              </label>

              <label>
                <FieldLabel>Training type</FieldLabel>
                <select
                  value={draft.trainingType}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      trainingType: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                >
                  <option>In-Service</option>
                  <option>Policy</option>
                  <option>Defensive Tactics</option>
                  <option>CPR / First Aid</option>
                  <option>Tactical</option>
                  <option>Remedial</option>
                  <option>External Course</option>
                  <option>Other</option>
                </select>
              </label>

              <label>
                <FieldLabel>Status</FieldLabel>
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      status: event.target.value as TrainingStatus,
                    }))
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                >
                  <option value="draft">Draft</option>
                  <option value="scheduled">Scheduled</option>
                </select>
              </label>

              <label>
                <FieldLabel>Starts</FieldLabel>
                <input
                  required
                  type="datetime-local"
                  value={draft.startsAt}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, startsAt: event.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                />
              </label>

              <label>
                <FieldLabel>Ends</FieldLabel>
                <input
                  type="datetime-local"
                  value={draft.endsAt}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, endsAt: event.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                />
              </label>

              <label>
                <FieldLabel>Location</FieldLabel>
                <input
                  value={draft.location}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, location: event.target.value }))
                  }
                  placeholder="Training room, range, or outside location"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                />
              </label>

              <label>
                <FieldLabel>Default hours</FieldLabel>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={draft.defaultHours}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      defaultHours: event.target.value,
                    }))
                  }
                  placeholder="Example: 4"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                />
              </label>

              <label>
                <FieldLabel>Category</FieldLabel>
                <input
                  value={draft.category}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, category: event.target.value }))
                  }
                  placeholder="Annual, mandated, specialized..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                />
              </label>

              <label>
                <FieldLabel>Topics</FieldLabel>
                <input
                  value={draft.topics}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, topics: event.target.value }))
                  }
                  placeholder="Comma-separated topics"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                />
              </label>

              <label className="md:col-span-2">
                <FieldLabel>Description and objectives</FieldLabel>
                <textarea
                  rows={4}
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Describe the course purpose, objectives, and required documentation."
                  className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                />
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <input
                  type="checkbox"
                  checked={draft.lessonPlanRequired}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      lessonPlanRequired: event.target.checked,
                    }))
                  }
                  className="mt-0.5 h-4 w-4 accent-blue-600"
                />
                <span>
                  <strong className="block text-xs text-white">Require lesson plan</strong>
                  <span className="mt-1 block text-[10px] leading-4 text-slate-500">
                    Prevent closeout until supporting lesson-plan documentation exists.
                  </span>
                </span>
              </label>

              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={draft.certificateEnabled}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        certificateEnabled: event.target.checked,
                      }))
                    }
                    className="mt-0.5 h-4 w-4 accent-blue-600"
                  />
                  <span>
                    <strong className="block text-xs text-white">
                      Generate certificates
                    </strong>
                    <span className="mt-1 block text-[10px] leading-4 text-slate-500">
                      Enable certificates for qualifying completed attendees.
                    </span>
                  </span>
                </label>
                {draft.certificateEnabled ? (
                  <input
                    value={draft.certificateTitle}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        certificateTitle: event.target.value,
                      }))
                    }
                    placeholder="Certificate title (optional)"
                    className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500"
                  />
                ) : null}
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-800 px-6 py-5">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-xl border border-slate-700 px-4 py-3 text-xs font-bold text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-xs font-bold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                Create Event
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {editorEvent !== undefined ? (
        <AgencyTrainingEventEditor
          event={editorEvent as EditableTrainingEvent | null}
          onClose={() => setEditorEvent(undefined)}
          onSaved={() => {
            setEditorEvent(undefined);
            void loadEvents();
          }}
        />
      ) : null}
    </TracePointShell>
  );
}