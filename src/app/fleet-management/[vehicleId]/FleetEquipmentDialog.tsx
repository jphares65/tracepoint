"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, Link2, Plus, RefreshCw, Search, X } from "lucide-react";

type Tab = "link" | "create";
type Props = { vehicleId: string; vehicle: any; existingEquipment: any[]; onClose: () => void; onSaved: (message: string) => Promise<void> };
const field = "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500";
const PREVIEW_ASSETS = [
  { id: "asset-aed", manufacturer: "ZOLL", model: "AED 3", serial_number: "AED-88412", category: "Medical", status: "Current" },
  { id: "asset-camera", manufacturer: "Axon", model: "Fleet 3", serial_number: "MVR-62041", category: "MVR", status: "Current" },
  { id: "asset-radar", manufacturer: "Stalker", model: "DSR 2X", serial_number: "RAD-77310", category: "Radar", status: "Current" },
];

function assetName(item: any) { return [item.manufacturer ?? item.make, item.model].filter(Boolean).join(" ") || item.name || "Equipment"; }

export default function FleetEquipmentDialog({ vehicleId, vehicle, existingEquipment, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<Tab>("link");
  const [assets, setAssets] = useState<any[]>(vehicleId === "preview" ? PREVIEW_ASSETS : []);
  const [selected, setSelected] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(vehicleId !== "preview");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ category: "Safety", name: "", make: "", model: "", year: "", serialNumber: "", tuningForkSerialNumber: "", warrantyExpirationDate: "", staticIp: "", quantity: 1, isRequired: true, isCritical: false, notes: "" });
  const set = (key: string, value: unknown) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (vehicleId === "preview") return;
    fetch("/api/equipment/assets", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Equipment inventory could not be loaded.");
      setAssets(Array.isArray(payload.items) ? payload.items : []);
    }).catch((e) => setError(e instanceof Error ? e.message : "Equipment inventory could not be loaded.")).finally(() => setLoading(false));
  }, [vehicleId]);

  const linkedIds = useMemo(() => new Set(existingEquipment.map((item) => item.linked_equipment_asset_id).filter(Boolean)), [existingEquipment]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return assets.filter((item) => !term || [assetName(item), item.serial_number, item.lot_number, item.category, item.status].some((value) => String(value ?? "").toLowerCase().includes(term)));
  }, [assets, search]);

  function choose(item: any) {
    if (linkedIds.has(item.id)) return;
    setSelected(item);
    const category = ["MDT","Modem","MVR","Radar","Medical","Safety","Emergency Equipment","Communications","Technology","Other"].includes(item.category) ? item.category : "Other";
    setForm((current) => ({ ...current, category, name: assetName(item), make: item.manufacturer ?? item.make ?? "", model: item.model ?? "", serialNumber: item.serial_number ?? item.lot_number ?? "", isRequired: true }));
  }

  async function save() {
    if (tab === "link" && !selected) { setError("Select an equipment record to link."); return; }
    if (!form.name.trim()) { setError("Equipment name is required."); return; }
    setSaving(true); setError("");
    try {
      const body = { ...form, sourceType: tab === "link" ? "Linked Inventory" : "Fleet Checklist", linkedEquipmentAssetId: tab === "link" ? selected.id : null, status: "Current" };
      if (vehicleId === "preview") {
        await onSaved(tab === "link" ? `${form.name} would be linked to Unit ${vehicle.unit_number}.` : `${form.name} would be added to Unit ${vehicle.unit_number}.`);
        onClose(); return;
      }
      const response = await fetch(`/api/fleet/vehicles/${vehicleId}/equipment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Equipment could not be saved.");
      await onSaved(tab === "link" ? "Existing inventory linked to the vehicle." : "Fleet equipment added to the vehicle.");
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Equipment could not be saved."); }
    finally { setSaving(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true">
    <div className="max-h-[95vh] w-full max-w-5xl overflow-y-auto rounded-t-3xl border border-slate-700 bg-slate-900 shadow-2xl sm:rounded-3xl">
      <header className="sticky top-0 z-20 flex items-start justify-between border-b border-slate-800 bg-slate-900/95 p-5 backdrop-blur"><div className="flex gap-3"><Boxes className="text-blue-300"/><div><h2 className="text-lg font-bold text-white">Add Vehicle Equipment</h2><p className="mt-1 text-xs text-slate-400">Unit {vehicle.unit_number} · Link tracked inventory or create a Fleet-only record</p></div></div><button onClick={onClose} className="rounded-xl border border-slate-700 p-2 text-slate-400 hover:text-white" aria-label="Close"><X size={16}/></button></header>
      <div className="p-5">
        <nav className="grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-950/50 p-1"><button onClick={() => { setTab("link"); setError(""); }} className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === "link" ? "bg-blue-600 text-white" : "text-slate-400"}`}><Link2 size={14} className="mr-2 inline"/>Link TracePoint Inventory</button><button onClick={() => { setTab("create"); setSelected(null); setError(""); }} className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === "create" ? "bg-blue-600 text-white" : "text-slate-400"}`}><Plus size={14} className="mr-2 inline"/>Create Fleet Equipment</button></nav>
        {error ? <div className="mt-4 rounded-xl border border-red-700 bg-red-950/30 p-3 text-sm text-red-200">{error}</div> : null}
        {tab === "link" ? <section className="mt-5 space-y-4"><div className="relative"><Search size={16} className="absolute left-3 top-3 text-slate-500"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search make, model, serial number, category, or status…" className={`${field} pl-10`}/></div>{loading ? <div className="flex h-40 items-center justify-center"><RefreshCw className="animate-spin text-blue-300"/></div> : <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-800"><div className="divide-y divide-slate-800">{filtered.length ? filtered.map((item) => { const linked = linkedIds.has(item.id); const active = selected?.id === item.id; return <button type="button" key={item.id} disabled={linked} onClick={() => choose(item)} className={`flex w-full items-center justify-between gap-4 p-4 text-left disabled:cursor-not-allowed disabled:opacity-40 ${active ? "bg-blue-500/10" : "hover:bg-slate-800/50"}`}><div><p className="text-sm font-bold text-white">{assetName(item)}</p><p className="mt-1 text-[10px] text-slate-500">{item.category || "Equipment"} · Serial {item.serial_number || item.lot_number || "not recorded"}</p></div><span className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase ${linked ? "border-slate-700 text-slate-500" : active ? "border-blue-500 text-blue-200" : "border-emerald-500/30 text-emerald-300"}`}>{linked ? "Already Linked" : active ? "Selected" : item.status || "Available"}</span></button>; }) : <div className="p-10 text-center text-sm text-slate-500">No matching equipment is available.</div>}</div></div>}</section> : null}
        {(tab === "create" || selected) ? <section className="mt-5 grid gap-4 border-t border-slate-800 pt-5 sm:grid-cols-2 lg:grid-cols-3"><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Category</span><select value={form.category} onChange={(e) => set("category", e.target.value)} className={field}>{["MDT","Modem","MVR","Radar","Medical","Safety","Emergency Equipment","Communications","Technology","Other"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="lg:col-span-2"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Display name</span><input value={form.name} onChange={(e) => set("name", e.target.value)} className={field}/></label><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Make</span><input value={form.make} onChange={(e) => set("make", e.target.value)} disabled={tab === "link"} className={`${field} disabled:opacity-60`}/></label><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Model</span><input value={form.model} onChange={(e) => set("model", e.target.value)} disabled={tab === "link"} className={`${field} disabled:opacity-60`}/></label><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Year</span><input type="number" min="1900" max="2200" value={form.year} onChange={(e) => set("year", e.target.value)} className={field}/></label><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Serial number</span><input value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} disabled={tab === "link"} className={`${field} disabled:opacity-60`}/></label><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Warranty expiration</span><input type="date" value={form.warrantyExpirationDate} onChange={(e) => set("warrantyExpirationDate", e.target.value)} className={field}/></label><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Quantity</span><input type="number" min="1" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} className={field}/></label>{form.category === "Modem" ? <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Static IP</span><input value={form.staticIp} onChange={(e) => set("staticIp", e.target.value)} className={field}/></label> : null}{form.category === "Radar" ? <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Tuning-fork serial</span><input value={form.tuningForkSerialNumber} onChange={(e) => set("tuningForkSerialNumber", e.target.value)} className={field}/></label> : null}<label className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3"><input type="checkbox" checked={form.isRequired} onChange={(e) => set("isRequired", e.target.checked)} className="h-5 w-5 accent-blue-600"/><span><span className="block text-xs font-bold text-white">Required</span><span className="text-[10px] text-slate-500">Include this exact item in inspections</span></span></label><label className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3"><input type="checkbox" checked={form.isCritical} onChange={(e) => set("isCritical", e.target.checked)} className="h-5 w-5 accent-red-600"/><span><span className="block text-xs font-bold text-white">Critical</span><span className="text-[10px] text-slate-500">Can affect vehicle availability</span></span></label><label className="sm:col-span-2 lg:col-span-3"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Notes</span><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className={`${field} min-h-20`}/></label></section> : null}
      </div>
      <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur"><button onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300">Cancel</button><button disabled={saving || (tab === "link" && !selected)} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">{saving ? <RefreshCw size={14} className="animate-spin"/> : tab === "link" ? <Link2 size={14}/> : <Plus size={14}/>} {tab === "link" ? "Link to Vehicle" : "Add Equipment"}</button></footer>
    </div>
  </div>;
}
