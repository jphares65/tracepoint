"use client";

import {
  BookOpen,
  Check,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type TrainingStatus =
  | "draft"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

type AdditionalInstructor = {
  userId: string | null;
  displayName: string;
  organization: string | null;
  credentials: string | null;
  instructorRole: string | null;
};

type AdditionalInstructorDraft = {
  key: string;
  mode: "internal" | "external";
  internalUserId: string;
  name: string;
  organization: string;
  credentials: string;
  role: string;
};

export type EditableTrainingEvent = {
  id: string;
  title: string;
  courseId?: string | null;
  trainingType: string;
  category: string | null;
  description: string | null;
  topics: string[];
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  defaultHours: number | null;
  status: TrainingStatus;
  certificateEnabled: boolean;
  certificateTitle: string | null;
  lessonPlanRequired: boolean;
  leadInstructor: string | null;
  leadInstructorUserId?: string | null;
  leadInstructorOrganization?: string | null;
  leadInstructorCredentials?: string | null;
  leadInstructorRole?: string | null;
  additionalInstructors?: AdditionalInstructor[];
};

type InstructorOption = {
  userId: string;
  fullName: string;
  badgeNumber: string | null;
  rankTitle: string | null;
  unitName: string | null;
};

type Course = {
  id: string;
  canonicalTitle: string;
  aliases: string[];
  trainingType: string;
  category: string | null;
  description: string | null;
  topics: string[];
  defaultLocation: string | null;
  defaultHours: number | null;
  lessonPlanRequired: boolean;
  certificateEnabled: boolean;
  certificateTitle: string | null;
  usageCount: number;
};

type Draft = {
  title: string;
  courseId: string;
  trainingType: string;
  category: string;
  description: string;
  topics: string;
  location: string;
  startsAt: string;
  endsAt: string;
  defaultHours: string;
  status: TrainingStatus;
  lessonPlanRequired: boolean;
  certificateEnabled: boolean;
  certificateTitle: string;
  instructorMode: "internal" | "external";
  internalInstructorUserId: string;
  outsideInstructorName: string;
  outsideInstructorOrganization: string;
  outsideInstructorCredentials: string;
  outsideInstructorRole: string;
  additionalInstructors: AdditionalInstructorDraft[];
  saveToLibrary: boolean;
};

function localDateTimeValue(value: string | Date | null | undefined) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function initialDraft(event?: EditableTrainingEvent | null): Draft {
  if (event) {
    return {
      title: event.title,
      courseId: event.courseId ?? "",
      trainingType: event.trainingType,
      category: event.category ?? "",
      description: event.description ?? "",
      topics: event.topics.join(", "),
      location: event.location ?? "",
      startsAt: localDateTimeValue(event.startsAt),
      endsAt: localDateTimeValue(event.endsAt),
      defaultHours: event.defaultHours?.toString() ?? "",
      status: event.status,
      lessonPlanRequired: event.lessonPlanRequired,
      certificateEnabled: event.certificateEnabled,
      certificateTitle: event.certificateTitle ?? "",
      instructorMode: event.leadInstructorUserId ? "internal" : "external",
      internalInstructorUserId: event.leadInstructorUserId ?? "",
      outsideInstructorName: event.leadInstructorUserId ? "" : event.leadInstructor ?? "",
      outsideInstructorOrganization: event.leadInstructorOrganization ?? "",
      outsideInstructorCredentials: event.leadInstructorCredentials ?? "",
      outsideInstructorRole: event.leadInstructorRole ?? "Lead Instructor",
      additionalInstructors: (event.additionalInstructors ?? []).map(
        (instructor, index) => ({
          key: `${instructor.userId ?? "external"}-${index}`,
          mode: instructor.userId ? "internal" : "external",
          internalUserId: instructor.userId ?? "",
          name: instructor.userId ? "" : instructor.displayName,
          organization: instructor.organization ?? "",
          credentials: instructor.credentials ?? "",
          role: instructor.instructorRole ?? "Instructor",
        }),
      ),
      saveToLibrary: false,
    };
  }

  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    title: "",
    courseId: "",
    trainingType: "In-Service",
    category: "",
    description: "",
    topics: "",
    location: "",
    startsAt: localDateTimeValue(start),
    endsAt: localDateTimeValue(end),
    defaultHours: "",
    status: "draft",
    lessonPlanRequired: false,
    certificateEnabled: false,
    certificateTitle: "",
    instructorMode: "internal",
    internalInstructorUserId: "",
    outsideInstructorName: "",
    outsideInstructorOrganization: "",
    outsideInstructorCredentials: "",
    outsideInstructorRole: "Lead Instructor",
    additionalInstructors: [],
    saveToLibrary: false,
  };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
      {children}
    </span>
  );
}

export default function AgencyTrainingEventEditor({
  event,
  onClose,
  onSaved,
}: {
  event?: EditableTrainingEvent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(event);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(event));
  const [courses, setCourses] = useState<Course[]>([]);
  const [instructors, setInstructors] = useState<InstructorOption[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [loadingInstructors, setLoadingInstructors] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reopenReason, setReopenReason] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/agency-training/courses", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          courses?: Course[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Course Library could not be loaded.");
        if (active) setCourses(Array.isArray(payload.courses) ? payload.courses : []);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Course Library could not be loaded.");
      })
      .finally(() => {
        if (active) setLoadingCourses(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/agency-training/instructors", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          instructors?: InstructorOption[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "Agency instructors could not be loaded.");
        }
        if (active) {
          const options = Array.isArray(payload.instructors) ? payload.instructors : [];
          setInstructors(options);
          setDraft((current) => ({
            ...current,
            internalInstructorUserId:
              current.internalInstructorUserId || options[0]?.userId || "",
          }));
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Agency instructors could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setLoadingInstructors(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const suggestions = useMemo(() => {
    const query = normalize(draft.title);
    if (query.length < 2) return courses.slice(0, 5);
    const words = query.split(" ").filter(Boolean);
    return courses
      .map((course) => {
        const candidates = [course.canonicalTitle, ...course.aliases].map(normalize);
        const exact = candidates.some((candidate) => candidate === query);
        const starts = candidates.some((candidate) => candidate.startsWith(query));
        const matches = Math.max(
          ...candidates.map((candidate) => words.filter((word) => candidate.includes(word)).length),
        );
        return { course, score: exact ? 1000 : starts ? 500 : matches * 20 + course.usageCount };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5)
      .map((item) => item.course);
  }, [courses, draft.title]);

  const selectedCourse = courses.find((course) => course.id === draft.courseId);

  function addInstructor() {
    setDraft((current) => ({
      ...current,
      additionalInstructors: [
        ...current.additionalInstructors,
        {
          key: crypto.randomUUID(),
          mode: "internal",
          internalUserId: instructors[0]?.userId ?? "",
          name: "",
          organization: "",
          credentials: "",
          role: "Instructor",
        },
      ],
    }));
  }

  function updateInstructor(
    key: string,
    patch: Partial<AdditionalInstructorDraft>,
  ) {
    setDraft((current) => ({
      ...current,
      additionalInstructors: current.additionalInstructors.map((instructor) =>
        instructor.key === key ? { ...instructor, ...patch } : instructor,
      ),
    }));
  }

  function removeInstructor(key: string) {
    setDraft((current) => ({
      ...current,
      additionalInstructors: current.additionalInstructors.filter(
        (instructor) => instructor.key !== key,
      ),
    }));
  }

  function useCourse(course: Course) {
    setDraft((current) => ({
      ...current,
      title: course.canonicalTitle,
      courseId: course.id,
      trainingType: course.trainingType,
      category: course.category ?? "",
      description: course.description ?? "",
      topics: course.topics.join(", "),
      location: course.defaultLocation ?? current.location,
      defaultHours: course.defaultHours?.toString() ?? "",
      lessonPlanRequired: course.lessonPlanRequired,
      certificateEnabled: course.certificateEnabled,
      certificateTitle: course.certificateTitle ?? "",
      saveToLibrary: false,
    }));
  }

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (saving || !draft.title.trim()) return;
    setSaving(true);
    setError("");

    try {
      let courseId = draft.courseId;
      const topics = draft.topics.split(",").map((topic) => topic.trim()).filter(Boolean);

      if (!editing && draft.saveToLibrary && !courseId) {
        const courseResponse = await fetch("/api/agency-training/courses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            canonicalTitle: draft.title,
            trainingType: draft.trainingType,
            category: draft.category,
            description: draft.description,
            topics,
            defaultLocation: draft.location,
            defaultHours: draft.defaultHours,
            lessonPlanRequired: draft.lessonPlanRequired,
            certificateEnabled: draft.certificateEnabled,
            certificateTitle: draft.certificateTitle,
          }),
        });
        const coursePayload = (await courseResponse.json().catch(() => ({}))) as {
          course?: Course;
          error?: string;
        };
        if (!courseResponse.ok || !coursePayload.course) {
          throw new Error(coursePayload.error || "The course could not be added to the library.");
        }
        courseId = coursePayload.course.id;
      }

      const response = await fetch(
        editing ? `/api/agency-training/events/${event?.id}` : "/api/agency-training/events",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: draft.title,
            courseId,
            trainingType: draft.trainingType,
            category: draft.category,
            description: draft.description,
            topics,
            location: draft.location,
            startsAt: draft.startsAt,
            endsAt: draft.endsAt,
            defaultHours: draft.defaultHours,
            status: draft.status,
            lessonPlanRequired: draft.lessonPlanRequired,
            certificateEnabled: draft.certificateEnabled,
            certificateTitle: draft.certificateTitle,
            instructorUserId:
              draft.instructorMode === "internal"
                ? draft.internalInstructorUserId
                : "",
            outsideInstructorName:
              draft.instructorMode === "external"
                ? draft.outsideInstructorName
                : "",
            outsideInstructorOrganization:
              draft.instructorMode === "external"
                ? draft.outsideInstructorOrganization
                : "",
            outsideInstructorCredentials:
              draft.instructorMode === "external"
                ? draft.outsideInstructorCredentials
                : "",
            outsideInstructorRole:
              draft.instructorMode === "external"
                ? draft.outsideInstructorRole
                : "Lead Instructor",
            addCurrentUserAsInstructor: false,
            additionalInstructors: draft.additionalInstructors.map((instructor) => ({
              mode: instructor.mode,
              userId:
                instructor.mode === "internal"
                  ? instructor.internalUserId
                  : "",
              displayName:
                instructor.mode === "external" ? instructor.name : "",
              organization:
                instructor.mode === "external" ? instructor.organization : "",
              credentials:
                instructor.mode === "external" ? instructor.credentials : "",
              instructorRole: instructor.role || "Instructor",
            })),
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "The training event could not be saved.");
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The training event could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function reopen() {
    if (!event || !reopenReason.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/agency-training/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reopen: true, reopenReason }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "The event could not be reopened.");
      onSaved();
    } catch (reopenError) {
      setError(reopenError instanceof Error ? reopenError.message : "The event could not be reopened.");
    } finally {
      setSaving(false);
    }
  }

  if (event?.status === "completed") {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
        <div className="w-full max-w-xl rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
          <div className="flex items-start justify-between border-b border-slate-800 px-6 py-5">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-400">Completed Record</p><h2 className="mt-1 text-xl font-bold text-white">Reopen training to edit</h2></div>
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 p-2 text-slate-400"><X size={18} /></button>
          </div>
          <div className="space-y-4 p-6">
            <p className="text-sm leading-6 text-slate-400">Completed training is locked to preserve its audit history. Enter a reason to reopen it.</p>
            <textarea rows={3} value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Reason for reopening" className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-amber-500" />
            {error ? <p className="text-xs text-rose-300">{error}</p> : null}
          </div>
          <div className="flex justify-end gap-3 border-t border-slate-800 px-6 py-5">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-3 text-xs font-bold text-slate-300">Cancel</button>
            <button type="button" onClick={() => void reopen()} disabled={saving || !reopenReason.trim()} className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-5 py-3 text-xs font-bold text-white disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Reopen Event</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-4 backdrop-blur-sm sm:p-8">
      <form onSubmit={submit} className="my-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-800 px-6 py-5">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">{editing ? "Training Record" : "New Training Record"}</p><h2 className="mt-1 text-xl font-bold text-white">{editing ? "Edit Training Event" : "Create Training Event"}</h2></div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 p-2 text-slate-400 hover:text-white" aria-label="Close event editor"><X size={18} /></button>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
          <div className="grid content-start gap-5 md:grid-cols-2">
            <label className="relative md:col-span-2">
              <FieldLabel>Course or event title</FieldLabel>
              <div className="relative"><Search size={15} className="absolute left-4 top-3.5 text-slate-600" /><input required value={draft.title} onChange={(e) => setDraft((current) => ({ ...current, title: e.target.value, courseId: current.title === e.target.value ? current.courseId : "" }))} placeholder="Begin typing to search the Course Library" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 pl-10 pr-4 text-sm font-semibold text-white outline-none focus:border-blue-500" /></div>
            </label>

            <label><FieldLabel>Training type</FieldLabel><select value={draft.trainingType} onChange={(e) => setDraft((current) => ({ ...current, trainingType: e.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500"><option>In-Service</option><option>Policy</option><option>Defensive Tactics</option><option>CPR / First Aid</option><option>Tactical</option><option>Remedial</option><option>External Course</option><option>Other</option></select></label>
            <label><FieldLabel>Status</FieldLabel><select value={draft.status} onChange={(e) => setDraft((current) => ({ ...current, status: e.target.value as TrainingStatus }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500"><option value="draft">Draft</option><option value="scheduled">Scheduled</option><option value="in_progress">In Progress</option><option value="cancelled">Cancelled</option></select></label>
            <label><FieldLabel>Starts</FieldLabel><input required type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft((current) => ({ ...current, startsAt: e.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500" /></label>
            <label><FieldLabel>Ends</FieldLabel><input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft((current) => ({ ...current, endsAt: e.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500" /></label>
            <label><FieldLabel>Location</FieldLabel><input value={draft.location} onChange={(e) => setDraft((current) => ({ ...current, location: e.target.value }))} placeholder="Training room or outside location" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500" /></label>
            <label><FieldLabel>Default hours</FieldLabel><input type="number" min="0" step="0.25" value={draft.defaultHours} onChange={(e) => setDraft((current) => ({ ...current, defaultHours: e.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500" /></label>
            <label><FieldLabel>Category</FieldLabel><input value={draft.category} onChange={(e) => setDraft((current) => ({ ...current, category: e.target.value }))} placeholder="Annual, mandated, specialized..." className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500" /></label>
            <label><FieldLabel>Topics</FieldLabel><input value={draft.topics} onChange={(e) => setDraft((current) => ({ ...current, topics: e.target.value }))} placeholder="Comma-separated topics" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500" /></label>
            <label className="md:col-span-2"><FieldLabel>Description and objectives</FieldLabel><textarea rows={3} value={draft.description} onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))} className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500" /></label>

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 md:col-span-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Users size={15} className="text-violet-300" />
                  <p className="text-xs font-bold text-white">Lead instructor</p>
                </div>
                <div className="inline-flex rounded-xl border border-slate-700 bg-slate-950 p-1">
                  <button
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, instructorMode: "internal" }))}
                    className={`rounded-lg px-3 py-2 text-[10px] font-bold transition ${
                      draft.instructorMode === "internal"
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Internal
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, instructorMode: "external" }))}
                    className={`rounded-lg px-3 py-2 text-[10px] font-bold transition ${
                      draft.instructorMode === "external"
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    External
                  </button>
                </div>
              </div>

              {draft.instructorMode === "internal" ? (
                <div className="mt-4">
                  <FieldLabel>Agency instructor</FieldLabel>
                  <select
                    required
                    value={draft.internalInstructorUserId}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        internalInstructorUserId: e.target.value,
                      }))
                    }
                    disabled={loadingInstructors}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none disabled:opacity-60 focus:border-blue-500"
                  >
                    <option value="">
                      {loadingInstructors ? "Loading personnel..." : "Select an instructor"}
                    </option>
                    {instructors.map((instructor) => (
                      <option key={instructor.userId} value={instructor.userId}>
                        {instructor.fullName}
                        {instructor.rankTitle ? ` / ${instructor.rankTitle}` : ""}
                        {instructor.badgeNumber ? ` / #${instructor.badgeNumber}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <input required value={draft.outsideInstructorName} onChange={(e) => setDraft((current) => ({ ...current, outsideInstructorName: e.target.value }))} placeholder="Instructor name" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-blue-500" />
                  <input value={draft.outsideInstructorOrganization} onChange={(e) => setDraft((current) => ({ ...current, outsideInstructorOrganization: e.target.value }))} placeholder="Organization" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-blue-500" />
                  <input value={draft.outsideInstructorCredentials} onChange={(e) => setDraft((current) => ({ ...current, outsideInstructorCredentials: e.target.value }))} placeholder="Credentials" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-blue-500" />
                  <input value={draft.outsideInstructorRole} onChange={(e) => setDraft((current) => ({ ...current, outsideInstructorRole: e.target.value }))} placeholder="Role" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-blue-500" />
                </div>
              )}

              <div className="mt-5 border-t border-slate-800 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-white">Additional instructors</p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Add any other internal or external instructors for this course.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addInstructor}
                    className="inline-flex items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-[10px] font-bold text-blue-300 hover:bg-blue-500/20"
                  >
                    <Plus size={13} /> Add Instructor
                  </button>
                </div>

                {draft.additionalInstructors.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {draft.additionalInstructors.map((instructor, index) => (
                      <div
                        key={instructor.key}
                        className="rounded-xl border border-slate-800 bg-slate-900/70 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                            Additional Instructor {index + 1}
                          </p>
                          <div className="flex items-center gap-2">
                            <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-1">
                              <button
                                type="button"
                                onClick={() =>
                                  updateInstructor(instructor.key, { mode: "internal" })
                                }
                                className={`rounded-md px-2.5 py-1.5 text-[9px] font-bold ${
                                  instructor.mode === "internal"
                                    ? "bg-blue-600 text-white"
                                    : "text-slate-500"
                                }`}
                              >
                                Internal
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  updateInstructor(instructor.key, { mode: "external" })
                                }
                                className={`rounded-md px-2.5 py-1.5 text-[9px] font-bold ${
                                  instructor.mode === "external"
                                    ? "bg-blue-600 text-white"
                                    : "text-slate-500"
                                }`}
                              >
                                External
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeInstructor(instructor.key)}
                              className="rounded-lg border border-slate-700 p-2 text-slate-500 hover:border-rose-500/40 hover:text-rose-300"
                              aria-label={`Remove additional instructor ${index + 1}`}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </div>

                        {instructor.mode === "internal" ? (
                          <select
                            required
                            value={instructor.internalUserId}
                            onChange={(e) =>
                              updateInstructor(instructor.key, {
                                internalUserId: e.target.value,
                              })
                            }
                            className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-blue-500"
                          >
                            <option value="">Select an instructor</option>
                            {instructors.map((option) => (
                              <option key={option.userId} value={option.userId}>
                                {option.fullName}
                                {option.rankTitle ? ` / ${option.rankTitle}` : ""}
                                {option.badgeNumber ? ` / #${option.badgeNumber}` : ""}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <input required value={instructor.name} onChange={(e) => updateInstructor(instructor.key, { name: e.target.value })} placeholder="Instructor name" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-blue-500" />
                            <input value={instructor.organization} onChange={(e) => updateInstructor(instructor.key, { organization: e.target.value })} placeholder="Organization" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-blue-500" />
                            <input value={instructor.credentials} onChange={(e) => updateInstructor(instructor.key, { credentials: e.target.value })} placeholder="Credentials" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-blue-500" />
                            <input value={instructor.role} onChange={(e) => updateInstructor(instructor.key, { role: e.target.value })} placeholder="Role" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-blue-500" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4"><input type="checkbox" checked={draft.lessonPlanRequired} onChange={(e) => setDraft((current) => ({ ...current, lessonPlanRequired: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-blue-600" /><span><strong className="block text-xs text-white">Require lesson plan</strong><span className="mt-1 block text-[10px] text-slate-500">Required before closeout.</span></span></label>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"><label className="flex items-start gap-3"><input type="checkbox" checked={draft.certificateEnabled} onChange={(e) => setDraft((current) => ({ ...current, certificateEnabled: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-blue-600" /><span><strong className="block text-xs text-white">Generate certificates</strong><span className="mt-1 block text-[10px] text-slate-500">For qualifying attendees.</span></span></label>{draft.certificateEnabled ? <input value={draft.certificateTitle} onChange={(e) => setDraft((current) => ({ ...current, certificateTitle: e.target.value }))} placeholder="Certificate title" className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500" /> : null}</div>
          </div>

          <aside className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
            <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-400">Course Library</p><h3 className="mt-1 text-sm font-bold text-white">Suggested matches</h3></div><BookOpen size={18} className="text-blue-300" /></div>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">Use one canonical course so differently worded events feed the same history and recurring requirement.</p>
            <div className="mt-4 space-y-2">
              {loadingCourses ? <div className="flex items-center gap-2 rounded-xl border border-slate-800 p-4 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading courses</div> : suggestions.length ? suggestions.map((course) => <button key={course.id} type="button" onClick={() => useCourse(course)} className={`w-full rounded-xl border p-3 text-left transition ${draft.courseId === course.id ? "border-blue-500/50 bg-blue-500/10" : "border-slate-800 bg-slate-900/60 hover:border-slate-700"}`}><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-bold text-white">{course.canonicalTitle}</p><p className="mt-1 text-[10px] text-slate-500">{course.trainingType}{course.category ? ` / ${course.category}` : ""}</p></div>{draft.courseId === course.id ? <Check size={15} className="text-emerald-300" /> : <ChevronRight size={15} className="text-slate-600" />}</div>{course.aliases.length ? <p className="mt-2 text-[9px] text-slate-600">Also known as: {course.aliases.slice(0, 2).join(", ")}</p> : null}</button>) : <div className="rounded-xl border border-dashed border-slate-700 p-4 text-xs leading-5 text-slate-500">No matching course yet. This can remain a one-time event or become a new library course.</div>}
            </div>
            {selectedCourse ? <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">Linked course</p><p className="mt-1 text-xs font-semibold text-white">{selectedCourse.canonicalTitle}</p><button type="button" onClick={() => setDraft((current) => ({ ...current, courseId: "" }))} className="mt-2 text-[10px] font-bold text-slate-400 hover:text-white">Remove link</button></div> : !editing ? <label className="mt-4 flex items-start gap-3 rounded-xl border border-slate-800 p-3"><input type="checkbox" checked={draft.saveToLibrary} onChange={(e) => setDraft((current) => ({ ...current, saveToLibrary: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-blue-600" /><span><strong className="block text-xs text-white">Add as a new library course</strong><span className="mt-1 block text-[10px] leading-4 text-slate-500">Use this title and these defaults for future training.</span></span></label> : null}
          </aside>
        </div>

        {error ? <div className="mx-6 mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">{error}</div> : null}
        <div className="flex justify-end gap-3 border-t border-slate-800 px-6 py-5"><button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-3 text-xs font-bold text-slate-300">Cancel</button><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-60">{saving ? <Loader2 size={15} className="animate-spin" /> : editing ? <Pencil size={15} /> : <Plus size={15} />}{editing ? "Save Changes" : "Create Event"}</button></div>
      </form>
    </div>
  );
}