"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Award, ChevronLeft, Pencil, Plus, Trash2, X } from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";

type Member = { user_id: string; full_name: string; badge_number?: string | null; rank_title?: string | null; is_active?: boolean };
type Certification = {
  id: string; user_id: string; certification_title: string; issuing_organization?: string | null;
  credential_number?: string | null; issue_date?: string | null; expiration_date?: string | null;
  reminder_days?: number[] | null; notes?: string | null; document_url?: string | null;
};

type FormState = {
  userId: string; certificationTitle: string; issuingOrganization: string; credentialNumber: string;
  issueDate: string; expirationDate: string; reminderDays: number[]; documentUrl: string; notes: string;
};

const DEFAULT_REMINDERS = [180, 90, 60, 30, 14, 7, 0];
const EMPTY_FORM: FormState = { userId: "", certificationTitle: "", issuingOrganization: "", credentialNumber: "", issueDate: "", expirationDate: "", reminderDays: [90, 60, 30, 14, 7, 0], documentUrl: "", notes: "" };

function getStatus(expirationDate?: string | null) {
  if (!expirationDate) return { label: "No Expiration", className: "border-slate-700 bg-slate-800/60 text-slate-300" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const expires = new Date(`${expirationDate}T00:00:00`);
  const days = Math.ceil((expires.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: "Expired", className: "border-red-500/30 bg-red-500/10 text-red-300" };
  if (days <= 90) return { label: `Due in ${days} days`, className: "border-amber-500/30 bg-amber-500/10 text-amber-300" };
  return { label: "Active", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" };
}

export default function CertificationsPage() {
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true); setError("");
    const response = await fetch("/api/training/certifications", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setError(payload.error || "Certifications could not be loaded.");
    else { setCertifications(payload.certifications ?? []); setMembers((payload.members ?? []).filter((m: Member) => m.is_active !== false)); setCanManage(Boolean(payload.canManage)); }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const memberMap = useMemo(() => new Map(members.map((member) => [member.user_id, member])), [members]);

  function openNew() { setEditingId(null); setForm(EMPTY_FORM); setModalOpen(true); }
  function openEdit(item: Certification) {
    setEditingId(item.id);
    setForm({ userId: item.user_id, certificationTitle: item.certification_title, issuingOrganization: item.issuing_organization ?? "", credentialNumber: item.credential_number ?? "", issueDate: item.issue_date ?? "", expirationDate: item.expiration_date ?? "", reminderDays: item.reminder_days ?? DEFAULT_REMINDERS, documentUrl: item.document_url ?? "", notes: item.notes ?? "" });
    setModalOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const response = await fetch(editingId ? `/api/training/certifications/${editingId}` : "/api/training/certifications", {
      method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setError(payload.error || "The certification could not be saved.");
    else { setModalOpen(false); await load(); }
    setSaving(false);
  }

  async function archive(id: string) {
    if (!window.confirm("Archive this certification? Its history will remain in the database.")) return;
    const response = await fetch(`/api/training/certifications/${id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setError(payload.error || "The certification could not be archived."); else await load();
  }

  return (
    <TracePointShell activePage="Training">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <Link href="/training" className="mb-5 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ChevronLeft size={16} /> Training</Link>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-400">Training</p>
            <h1 className="mt-2 text-3xl font-bold text-white">Certifications</h1>
            <p className="mt-2 text-sm text-slate-400">Store any officer credential and receive reminders before it expires.</p>
          </div>
          {canManage ? <button onClick={openNew} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"><Plus size={16} /> Add Certification</button> : null}
        </div>

        {error ? <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}

        <div className="mt-7 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/40">
          {loading ? <div className="p-8 text-sm text-slate-500">Loading certificationsâ€¦</div> : certifications.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-14 text-center"><Award size={34} className="text-slate-700" /><h2 className="mt-4 font-semibold text-white">No certifications recorded</h2><p className="mt-2 max-w-md text-sm text-slate-500">Add the first credential to begin expiration tracking and renewal reminders.</p></div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-4">Officer</th><th className="px-5 py-4">Certification</th><th className="px-5 py-4">Issuer</th><th className="px-5 py-4">Expires</th><th className="px-5 py-4">Status</th><th className="px-5 py-4 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-800">{certifications.map((item) => { const member = memberMap.get(item.user_id); const status = getStatus(item.expiration_date); return <tr key={item.id} className="hover:bg-slate-900/40"><td className="px-5 py-4"><div className="font-medium text-white">{member?.full_name || "Unknown officer"}</div><div className="text-xs text-slate-500">{[member?.rank_title, member?.badge_number ? `#${member.badge_number}` : ""].filter(Boolean).join(" · ")}</div></td><td className="px-5 py-4"><div className="font-medium text-slate-200">{item.certification_title}</div><div className="text-xs text-slate-500">{item.credential_number || "No credential number"}</div></td><td className="px-5 py-4 text-slate-400">{item.issuing_organization || "—"}</td><td className="px-5 py-4 text-slate-300">{item.expiration_date || "None"}</td><td className="px-5 py-4"><span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${status.className}`}>{status.label}</span></td><td className="px-5 py-4"><div className="flex justify-end gap-2">{canManage ? <><button onClick={() => openEdit(item)} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white" title="Edit"><Pencil size={15} /></button><button onClick={() => void archive(item.id)} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:border-red-500/40 hover:text-red-300" title="Archive"><Trash2 size={15} /></button></> : null}</div></td></tr>; })}</tbody></table></div>
          )}
        </div>
      </div>

      {modalOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"><form onSubmit={save} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"><div className="flex items-center justify-between border-b border-slate-800 px-6 py-5"><div><h2 className="text-lg font-semibold text-white">{editingId ? "Edit Certification" : "Add Certification"}</h2><p className="mt-1 text-xs text-slate-500">Certification names and reminder schedules are fully configurable.</p></div><button type="button" onClick={() => setModalOpen(false)} className="text-slate-500 hover:text-white"><X size={20} /></button></div><div className="grid gap-5 p-6 md:grid-cols-2">
        <label className="text-sm text-slate-300">Officer<select required value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"><option value="">Select officer</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name}</option>)}</select></label>
        <label className="text-sm text-slate-300">Certification title<input required value={form.certificationTitle} onChange={(e) => setForm({ ...form, certificationTitle: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white" placeholder="Firearms Instructor" /></label>
        <label className="text-sm text-slate-300">Issuing organization<input value={form.issuingOrganization} onChange={(e) => setForm({ ...form, issuingOrganization: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white" /></label>
        <label className="text-sm text-slate-300">Credential number<input value={form.credentialNumber} onChange={(e) => setForm({ ...form, credentialNumber: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white" /></label>
        <label className="text-sm text-slate-300">Issue date<input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white" /></label>
        <label className="text-sm text-slate-300">Expiration date<input type="date" value={form.expirationDate} onChange={(e) => setForm({ ...form, expirationDate: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white" /></label>
        <label className="text-sm text-slate-300 md:col-span-2">Document link<input value={form.documentUrl} onChange={(e) => setForm({ ...form, documentUrl: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white" placeholder="SharePoint or secure document URL" /></label>
        <fieldset className="md:col-span-2"><legend className="text-sm text-slate-300">Reminder schedule</legend><div className="mt-3 flex flex-wrap gap-2">{DEFAULT_REMINDERS.map((day) => { const selected = form.reminderDays.includes(day); return <button key={day} type="button" onClick={() => setForm({ ...form, reminderDays: selected ? form.reminderDays.filter((value) => value !== day) : [...form.reminderDays, day].sort((a, b) => b - a) })} className={`rounded-full border px-3 py-1.5 text-xs ${selected ? "border-blue-500/50 bg-blue-500/15 text-blue-200" : "border-slate-700 text-slate-500"}`}>{day === 0 ? "On expiration" : `${day} days`}</button>; })}</div></fieldset>
        <label className="text-sm text-slate-300 md:col-span-2">Notes<textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white" /></label>
      </div><div className="flex justify-end gap-3 border-t border-slate-800 px-6 py-4"><button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300">Cancel</button><button disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Savingâ€¦" : "Save Certification"}</button></div></form></div> : null}
    </TracePointShell>
  );
}

