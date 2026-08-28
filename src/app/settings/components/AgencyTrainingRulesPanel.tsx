"use client";
import { Bell, BookOpenCheck, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Course = { id: string; canonicalTitle?: string; canonical_title?: string; isActive?: boolean; is_active?: boolean };
type Requirement = Record<string, any> & { id: string };
const EMPTY = {
  requirementId: "", courseId: "", requirementName: "", scopeType: "all_members",
  scopeValues: "", intervalValue: "12", intervalUnit: "months", dueBasis: "completion_date",
  fixedMonth: "1", fixedDay: "1", warningDays: "90, 60, 30, 14, 7, 0", graceDays: "0",
  notifyMemberInbox: true, notifyMemberEmail: true,
  notifyTrainingStaffInbox: true, notifyTrainingStaffEmail: true,
  isActive: true, notes: "",
};
function courseTitle(course: Course) { return course.canonicalTitle ?? course.canonical_title ?? "Untitled Course"; }
function bool(row: any, camel: string, snake: string, fallback = true) { const value = row?.[camel] ?? row?.[snake]; return value == null ? fallback : value === true; }
function list(row: any, camel: string, snake: string) { const value = row?.[camel] ?? row?.[snake]; return Array.isArray(value) ? value : []; }

export default function AgencyTrainingRulesPanel() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [draft, setDraft] = useState({ ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [courseResponse, requirementResponse] = await Promise.all([
      fetch("/api/agency-training/courses", { cache: "no-store" }),
      fetch("/api/agency-training/requirements", { cache: "no-store" }),
    ]);
    const coursePayload = await courseResponse.json().catch(() => ({}));
    const requirementPayload = await requirementResponse.json().catch(() => ({}));
    if (!courseResponse.ok || !requirementResponse.ok) setError(coursePayload.error || requirementPayload.error || "Agency Training rules could not be loaded.");
    else { setCourses((coursePayload.courses ?? []).filter((item: Course) => item.isActive !== false && item.is_active !== false)); setRequirements(requirementPayload.requirements ?? []); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const courseNames = useMemo(() => new Map(courses.map((course) => [course.id, courseTitle(course)])), [courses]);

  function edit(row: Requirement) {
    setDraft({
      requirementId: row.id,
      courseId: row.course_id ?? row.courseId ?? "",
      requirementName: row.requirement_name ?? row.requirementName ?? "",
      scopeType: row.scope_type ?? row.scopeType ?? "all_members",
      scopeValues: list(row, "scopeValues", "scope_values").join(", "),
      intervalValue: String(row.interval_value ?? row.intervalValue ?? ""),
      intervalUnit: row.interval_unit ?? row.intervalUnit ?? "months",
      dueBasis: row.due_basis ?? row.dueBasis ?? "completion_date",
      fixedMonth: String(row.fixed_month ?? row.fixedMonth ?? 1),
      fixedDay: String(row.fixed_day ?? row.fixedDay ?? 1),
      warningDays: list(row, "warningDays", "warning_days").join(", "),
      graceDays: String(row.grace_days ?? row.graceDays ?? 0),
      notifyMemberInbox: bool(row, "notifyMemberInbox", "notify_member_inbox"),
      notifyMemberEmail: bool(row, "notifyMemberEmail", "notify_member_email"),
      notifyTrainingStaffInbox: bool(row, "notifyTrainingStaffInbox", "notify_training_staff_inbox"),
      notifyTrainingStaffEmail: bool(row, "notifyTrainingStaffEmail", "notify_training_staff_email"),
      isActive: bool(row, "isActive", "is_active"), notes: row.notes ?? "",
    });
    setShowForm(true); setError(""); setMessage("");
  }

  async function save() {
    if (saving) return;
    setSaving(true); setError(""); setMessage("");
    const response = await fetch("/api/agency-training/requirements", {
      method: draft.requirementId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...draft,
        scopeValues: draft.scopeValues.split(",").map((item) => item.trim()).filter(Boolean),
        warningDays: draft.warningDays.split(",").map((item) => Number(item.trim())).filter(Number.isFinite),
        intervalValue: draft.intervalValue ? Number(draft.intervalValue) : null,
        fixedMonth: Number(draft.fixedMonth), fixedDay: Number(draft.fixedDay), graceDays: Number(draft.graceDays),
      }),
    });
    const payload = await response.json().catch(() => ({})); setSaving(false);
    if (!response.ok) { setError(payload.error || "Training requirement could not be saved."); return; }
    setDraft({ ...EMPTY }); setShowForm(false); setMessage("Agency Training requirement saved."); await load();
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this recurring training requirement? Existing training and certification records will remain.")) return;
    const response = await fetch("/api/agency-training/requirements", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requirementId: id }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setError(payload.error || "Training requirement could not be removed."); return; }
    setMessage("Training requirement removed."); await load();
  }

  if (loading) return <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><Loader2 size={16} className="animate-spin"/> Loading Agency Training rules</div>;
  return <div className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-sm font-semibold text-white">Recurring Course Requirements</p><p className="mt-1 text-xs leading-5 text-slate-500">Set the agency cadence, applicable personnel, warning schedule, and officer/training-staff delivery for courses in the Course Library.</p></div>
      <button type="button" onClick={() => { setDraft({ ...EMPTY }); setShowForm(true); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-500"><Plus size={14}/> Add Requirement</button>
    </div>
    {error ? <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">{error}</div> : null}
    {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">{message}</div> : null}
    {requirements.length ? <div className="space-y-2">{requirements.map((row) => <div key={row.id} className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-bold text-white">{row.requirement_name}</p><p className="mt-1 text-xs text-slate-500">{courseNames.get(row.course_id) ?? row.agency_training_courses?.canonical_title ?? "Course"} / {row.interval_value ? `Every ${row.interval_value} ${row.interval_unit}` : "One-time completion"} / {(row.scope_type ?? "all_members").replaceAll("_", " ")}</p></div><div className="flex gap-2"><button onClick={() => edit(row)} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-blue-300"><Pencil size={14}/></button><button onClick={() => void remove(row.id)} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-rose-300"><Trash2 size={14}/></button></div></div>)}</div> : <div className="rounded-xl border border-dashed border-slate-700 px-6 py-10 text-center"><BookOpenCheck size={24} className="mx-auto text-slate-600"/><p className="mt-3 text-sm font-bold text-slate-300">No recurring requirements configured</p></div>}
    {showForm ? <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"><div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"><div className="flex items-start justify-between border-b border-slate-800 p-5"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">Rules Engine</p><h3 className="mt-1 text-lg font-bold text-white">{draft.requirementId ? "Edit" : "Add"} Training Requirement</h3></div><button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-700 p-2 text-slate-400"><X size={15}/></button></div><div className="grid gap-4 p-5 sm:grid-cols-2">
      <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold text-slate-300">Requirement name</span><input value={draft.requirementName} onChange={(e) => setDraft((d) => ({ ...d, requirementName: e.target.value }))} placeholder="Annual Use of Force Training" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"/></label>
      <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold text-slate-300">Course Library course</span><select value={draft.courseId} onChange={(e) => setDraft((d) => ({ ...d, courseId: e.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="">Choose a course</option>{courses.map((course) => <option key={course.id} value={course.id}>{courseTitle(course)}</option>)}</select></label>
      <label><span className="mb-1 block text-xs font-bold text-slate-300">Applies to</span><select value={draft.scopeType} onChange={(e) => setDraft((d) => ({ ...d, scopeType: e.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="all_members">All active personnel</option><option value="rank">Selected ranks</option><option value="unit">Selected units</option></select></label>
      <label><span className="mb-1 block text-xs font-bold text-slate-300">Rank/unit values</span><input value={draft.scopeValues} disabled={draft.scopeType === "all_members"} onChange={(e) => setDraft((d) => ({ ...d, scopeValues: e.target.value }))} placeholder="Patrol, Detectives" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white disabled:opacity-40"/></label>
      <label><span className="mb-1 block text-xs font-bold text-slate-300">Repeat every</span><input type="number" min="1" value={draft.intervalValue} onChange={(e) => setDraft((d) => ({ ...d, intervalValue: e.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"/></label>
      <label><span className="mb-1 block text-xs font-bold text-slate-300">Interval</span><select value={draft.intervalUnit} onChange={(e) => setDraft((d) => ({ ...d, intervalUnit: e.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="days">Days</option><option value="months">Months</option><option value="years">Years</option><option value="calendar_year">Calendar year</option></select></label>
      <label><span className="mb-1 block text-xs font-bold text-slate-300">Warning days</span><input value={draft.warningDays} onChange={(e) => setDraft((d) => ({ ...d, warningDays: e.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"/></label>
      <label><span className="mb-1 block text-xs font-bold text-slate-300">Grace days</span><input type="number" min="0" value={draft.graceDays} onChange={(e) => setDraft((d) => ({ ...d, graceDays: e.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"/></label>
      <div className="sm:col-span-2 rounded-xl border border-slate-800 p-4"><p className="mb-3 flex items-center gap-2 text-xs font-bold text-white"><Bell size={14}/> Notification delivery</p><div className="grid gap-3 sm:grid-cols-2">{[["notifyMemberInbox","Officer Inbox"],["notifyMemberEmail","Officer email"],["notifyTrainingStaffInbox","Training staff Inbox"],["notifyTrainingStaffEmail","Training staff email"]].map(([key,label]) => <label key={key} className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={(draft as any)[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.checked }))} className="h-4 w-4 accent-blue-600"/>{label}</label>)}</div></div>
    </div><div className="flex justify-end gap-2 border-t border-slate-800 p-5"><button onClick={() => setShowForm(false)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300">Cancel</button><button onClick={() => void save()} disabled={saving || !draft.courseId || !draft.requirementName.trim()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>} Save Requirement</button></div></div></div> : null}
  </div>;
}