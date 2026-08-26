"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Wrench, X } from "lucide-react";

type Mode = "issue" | "maintenance";

type Props = {
  mode: Mode;
  vehicleId: string;
  vehicle: any;
  item?: any;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
};

const field = "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500";

function initial(mode: Mode, vehicle: any, item?: any) {
  return {
    id: item?.id ?? "",
    recordType: mode === "issue" ? "Issue" : item?.record_type ?? "Preventive Maintenance",
    issueCategory: item?.issue_category ?? "Mechanical",
    title: item?.title ?? "",
    description: item?.description ?? "",
    priority: item?.priority ?? "Normal",
    status: mode === "issue" ? "Open" : item?.status ?? "Open",
    operability: item?.affects_availability ? "Unsafe - remove from service" : "Safe to operate",
    affectsAvailability: item?.affects_availability === true,
    mileage: item?.mileage ?? vehicle.current_mileage ?? "",
    hours: item?.hours ?? vehicle.current_hours ?? "",
    scheduledFor: item?.scheduled_for ?? "",
    dueDate: item?.due_date ?? "",
    mechanicName: item?.mechanic_name ?? "",
    vendor: item?.vendor ?? "",
    laborCost: item?.labor_cost ?? "",
    partsCost: item?.parts_cost ?? "",
    resolution: item?.resolution ?? "",
    notes: item?.notes ?? "",
    nextServiceDate: vehicle.next_service_date ?? "",
    nextServiceMileage: vehicle.next_service_mileage ?? "",
    nextServiceHours: vehicle.next_service_hours ?? "",
    reason: "",
  };
}

export default function FleetWorkOrderDialog({ mode, vehicleId, vehicle, item, onClose, onSaved }: Props) {
  const [form, setForm] = useState(() => initial(mode, vehicle, item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setForm(initial(mode, vehicle, item)), [mode, vehicle, item]);
  const total = useMemo(() => (Number(form.laborCost) || 0) + (Number(form.partsCost) || 0), [form.laborCost, form.partsCost]);
  const set = (key: string, value: unknown) => setForm((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (!form.title.trim()) { setError(mode === "issue" ? "Briefly describe the issue." : "A maintenance title is required."); return; }
    if (item && !form.reason.trim()) { setError("Enter the reason for this work-order update."); return; }
    setSaving(true); setError("");
    try {
      const body = {
        ...form,
        affectsAvailability: mode === "issue" ? form.operability === "Unsafe - remove from service" : form.affectsAvailability,
        totalCost: total || "",
      };
      if (vehicleId === "preview") {
        await onSaved(mode === "issue" ? "Preview issue submitted. The configured mechanic role would receive an Inbox notification." : "Preview maintenance record completed. No data was saved in preview mode.");
        onClose(); return;
      }
      const response = await fetch(`/api/fleet/vehicles/${vehicleId}/work-orders`, {
        method: item ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The work item could not be saved.");
      await onSaved(mode === "issue" ? "Issue reported and routed to the configured mechanic role." : "Maintenance work order saved and recorded in Fleet history.");
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "The work item could not be saved."); }
    finally { setSaving(false); }
  }

  const issue = mode === "issue";
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true">
    <div className="max-h-[95vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl border border-slate-700 bg-slate-900 shadow-2xl sm:rounded-3xl">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-900/95 p-5 backdrop-blur">
        <div className="flex gap-3">{issue ? <AlertTriangle className="text-amber-300"/> : <Wrench className="text-blue-300"/>}<div><h2 className="text-lg font-bold text-white">{issue ? "Report a Vehicle Issue" : item ? "Manage Maintenance Work Order" : "Add Maintenance Work Order"}</h2><p className="mt-1 text-xs text-slate-400">Unit {vehicle.unit_number} · {issue ? "Routes directly to the agency mechanic role" : "Complete service and repair tracking"}</p></div></div>
        <button onClick={onClose} className="rounded-xl border border-slate-700 p-2 text-slate-400 hover:text-white" aria-label="Close"><X size={16}/></button>
      </header>
      <div className="space-y-5 p-5">
        {error ? <div className="rounded-xl border border-red-700 bg-red-950/30 p-3 text-sm text-red-200">{error}</div> : null}
        <section className="grid gap-4 sm:grid-cols-2">
          {issue ? <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Issue category</span><select value={form.issueCategory} onChange={(e) => set("issueCategory", e.target.value)} className={field}>{["Mechanical","Safety","Damage","Electrical","Emergency Equipment","Technology","Other"].map((value) => <option key={value}>{value}</option>)}</select></label> : <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Work type</span><select value={form.recordType} onChange={(e) => set("recordType", e.target.value)} className={field}>{item?.record_type === "Issue" ? <option>Issue</option> : null}<option>Preventive Maintenance</option><option>Repair</option><option>Recall</option></select></label>}
          <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Priority</span><select value={form.priority} onChange={(e) => set("priority", e.target.value)} className={field}><option>Normal</option><option>High</option><option>Critical</option></select></label>
          <label className="sm:col-span-2"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{issue ? "What is wrong?" : "Work-order title"}</span><input autoFocus value={form.title} onChange={(e) => set("title", e.target.value)} placeholder={issue ? "Example: Driver-side spotlight flickers" : "Example: 20,000-mile preventive service"} className={field}/></label>
          <label className="sm:col-span-2"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Details</span><textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder={issue ? "Add what happened, when it occurs, and anything the mechanic should know." : "Describe the requested service or repair."} className={`${field} min-h-24`}/></label>
          {issue ? <label className="sm:col-span-2"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Can the vehicle be operated safely?</span><div className="grid gap-2 sm:grid-cols-3">{["Safe to operate","Limited use / needs review","Unsafe - remove from service"].map((value) => <button type="button" key={value} onClick={() => set("operability", value)} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${form.operability === value ? value.startsWith("Unsafe") ? "border-red-500 bg-red-500/15 text-red-200" : value.startsWith("Limited") ? "border-amber-500 bg-amber-500/15 text-amber-200" : "border-emerald-500 bg-emerald-500/15 text-emerald-200" : "border-slate-700 text-slate-400"}`}>{value}</button>)}</div></label> : null}
          <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Current mileage</span><input type="number" min="0" value={form.mileage} onChange={(e) => set("mileage", e.target.value)} className={field}/></label>
          <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Engine hours</span><input type="number" min="0" step="0.1" value={form.hours} onChange={(e) => set("hours", e.target.value)} className={field}/></label>
        </section>

        {!issue ? <>
          <section className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4"><h3 className="text-sm font-bold text-white">Assignment and schedule</h3><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Status</span><select value={form.status} onChange={(e) => set("status", e.target.value)} className={field}>{["Open","Assigned","Scheduled","In Progress","Awaiting Parts","Completed","Cancelled"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Scheduled date</span><input type="date" value={form.scheduledFor} onChange={(e) => set("scheduledFor", e.target.value)} className={field}/></label>
            <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Due date</span><input type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} className={field}/></label>
            <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Mechanic</span><input value={form.mechanicName} onChange={(e) => set("mechanicName", e.target.value)} className={field}/></label>
            <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Vendor</span><input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} className={field}/></label>
            <label className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2"><input type="checkbox" checked={form.affectsAvailability} onChange={(e) => set("affectsAvailability", e.target.checked)} className="h-5 w-5 accent-red-600"/><span className="text-xs font-semibold text-slate-300">Vehicle unavailable during work</span></label>
          </div></section>
          <section className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4"><h3 className="text-sm font-bold text-white">Work performed and cost</h3><div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Labor cost</span><input type="number" min="0" step="0.01" value={form.laborCost} onChange={(e) => set("laborCost", e.target.value)} className={field}/></label>
            <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Parts cost</span><input type="number" min="0" step="0.01" value={form.partsCost} onChange={(e) => set("partsCost", e.target.value)} className={field}/></label>
            <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Total</span><div className={`${field} text-slate-300`}>{total.toLocaleString("en-US", { style: "currency", currency: "USD" })}</div></label>
            <label className="sm:col-span-3"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Work performed / resolution</span><textarea value={form.resolution} onChange={(e) => set("resolution", e.target.value)} className={`${field} min-h-24`}/></label>
            <label className="sm:col-span-3"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Parts, invoice, or internal notes</span><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className={`${field} min-h-20`}/></label>
          </div></section>
          <section className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4"><h3 className="text-sm font-bold text-white">Next service targets</h3><div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Next service date</span><input type="date" value={form.nextServiceDate} onChange={(e) => set("nextServiceDate", e.target.value)} className={field}/></label>
            <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Next service mileage</span><input type="number" min="0" value={form.nextServiceMileage} onChange={(e) => set("nextServiceMileage", e.target.value)} className={field}/></label>
            <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Next service hours</span><input type="number" min="0" step="0.1" value={form.nextServiceHours} onChange={(e) => set("nextServiceHours", e.target.value)} className={field}/></label>
          </div></section>
          {item ? <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Reason for update</span><input value={form.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Required for audit history" className={field}/></label> : null}
        </> : null}
      </div>
      <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur"><button onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300">Cancel</button><button disabled={saving} onClick={() => void submit()} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50 ${issue ? "bg-amber-600" : "bg-blue-600"}`}>{saving ? <RefreshCw size={14} className="animate-spin"/> : issue ? <AlertTriangle size={14}/> : <Wrench size={14}/>} {issue ? "Submit to Mechanic" : "Save Work Order"}</button></footer>
    </div>
  </div>;
}
