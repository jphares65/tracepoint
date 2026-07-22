"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, Check, Clock3, ExternalLink, Loader2, RefreshCw, Settings, ShieldAlert } from "lucide-react";
import TracePointShell from "@/app/components/TracePointShell";

type Item = {
  id: string;
  title: string;
  detail: string;
  href: string;
  priority: "Critical" | "High" | "Normal";
  source: string;
  createdAt?: string | null;
  acknowledgedAt?: string | null;
  snoozedUntil?: string | null;
};

type Payload = {
  items: Item[];
  allOpenItems: Item[];
  preferences: {
    in_app_enabled: boolean;
    email_enabled: boolean;
    critical_email_only: boolean;
    digest_mode: "Immediate" | "Daily" | "Weekly";
    source_preferences: Record<string, boolean>;
  };
  sourceErrors: Array<{ source: string; error: string }>;
  counts: Record<string, number>;
};

const sources = ["Personal Rifle", "Ammunition", "Inspection", "Range"];

async function errorText(response: Response) {
  const payload = await response.json().catch(() => ({}));
  return payload?.error || "The request failed.";
}

function style(priority: Item["priority"]) {
  if (priority === "Critical") return "border-red-500/40 bg-red-500/[0.08]";
  if (priority === "High") return "border-amber-500/35 bg-amber-500/[0.07]";
  return "border-slate-800 bg-slate-900/80";
}

function Icon({ priority }: { priority: Item["priority"] }) {
  if (priority === "Critical") return <ShieldAlert size={18} className="text-red-300" />;
  if (priority === "High") return <AlertTriangle size={18} className="text-amber-300" />;
  return <Bell size={18} className="text-blue-300" />;
}

export default function NotificationsPage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [filter, setFilter] = useState("Open");
  const [source, setSource] = useState("All");
  const [showPreferences, setShowPreferences] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) throw new Error(await errorText(response));
      setPayload(await response.json() as Payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Notifications could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    if (!payload) return [];
    const base = filter === "Open"
      ? payload.items
      : payload.allOpenItems.filter((item) => filter === "Acknowledged"
          ? Boolean(item.acknowledgedAt)
          : Boolean(item.snoozedUntil && new Date(item.snoozedUntil).getTime() > Date.now()));
    return source === "All" ? base : base.filter((item) => item.source === source);
  }, [payload, filter, source]);

  async function act(action: string, item: Item) {
    setSaving(true);
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          notificationId: item.id,
          snoozedUntil: action === "snooze" ? new Date(Date.now() + 86400000).toISOString() : undefined,
        }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Notification could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  async function savePreferences() {
    if (!payload) return;
    setSaving(true);
    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.preferences),
      });
      if (!response.ok) throw new Error(await errorText(response));
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Preferences could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TracePointShell activePage="My Home">
      <div className="mx-auto w-full max-w-[1450px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">TracePoint / Notifications</p>
              <h1 className="mt-1 text-2xl font-bold text-white">Operational Inbox</h1>
              <p className="mt-1 text-sm text-slate-500">Persistent alerts from Ammunition, Personal Rifles, Inspections, and Range Operations.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowPreferences((value) => !value)} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300"><Settings size={15} />Preferences</button>
              <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white"><RefreshCw size={15} />Refresh</button>
            </div>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-red-700 bg-red-950/30 p-4 text-sm text-red-200">{error}</div> : null}
        {payload?.sourceErrors?.length ? <div className="rounded-2xl border border-amber-700 bg-amber-950/25 p-4 text-sm text-amber-200">Unavailable sources: {payload.sourceErrors.map((item) => item.source).join(", ")}.</div> : null}

        {showPreferences && payload ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="font-bold text-white">Preferences</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[["in_app_enabled", "In-app notifications"], ["email_enabled", "Email notifications"], ["critical_email_only", "Critical email only"]].map(([key, label]) => (
                <label key={key} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                  <input type="checkbox" checked={Boolean(payload.preferences[key as keyof Payload["preferences"]])} onChange={(event) => setPayload((current) => current ? { ...current, preferences: { ...current.preferences, [key]: event.target.checked } } : current)} />
                  <span className="text-sm text-slate-300">{label}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {sources.map((item) => (
                <label key={item} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                  <input type="checkbox" checked={payload.preferences.source_preferences[item] !== false} onChange={(event) => setPayload((current) => current ? { ...current, preferences: { ...current.preferences, source_preferences: { ...current.preferences.source_preferences, [item]: event.target.checked } } } : current)} />
                  {item}
                </label>
              ))}
            </div>
            <button onClick={() => void savePreferences()} disabled={saving} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save Preferences</button>
          </section>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {["open", "critical", "high", "acknowledged", "snoozed"].map((key) => (
            <div key={key} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-600">{key}</p>
              <p className="mt-1 text-2xl font-bold text-white">{payload?.counts[key] ?? 0}</p>
            </div>
          ))}
        </section>

        <section className="flex flex-wrap gap-2 rounded-3xl border border-slate-800 bg-slate-900/70 p-4">
          {["Open", "Acknowledged", "Snoozed"].map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-xl border px-3 py-2 text-sm ${filter === item ? "border-blue-500 text-blue-200" : "border-slate-700 text-slate-400"}`}>{item}</button>)}
          <select value={source} onChange={(event) => setSource(event.target.value)} className="ml-auto rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300"><option>All</option>{sources.map((item) => <option key={item}>{item}</option>)}</select>
        </section>

        {loading ? <div className="flex min-h-[300px] items-center justify-center rounded-3xl border border-slate-800 bg-slate-900"><Loader2 className="animate-spin text-blue-300" /></div> : visible.length === 0 ? <div className="rounded-3xl border border-emerald-800 bg-emerald-950/20 p-10 text-center text-emerald-200">No notifications in this view.</div> : (
          <div className="space-y-3">
            {visible.map((item) => (
              <article key={item.id} className={`rounded-3xl border p-5 ${style(item.priority)}`}>
                <div className="flex items-start gap-3"><Icon priority={item.priority} /><div className="flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-white">{item.title}</h2><span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-500">{item.source}</span></div><p className="mt-2 text-sm text-slate-400">{item.detail}</p><div className="mt-4 flex flex-wrap gap-2"><Link href={item.href} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white">Open<ExternalLink size={14} /></Link>{filter === "Open" ? <><button disabled={saving} onClick={() => void act("acknowledge", item)} className="inline-flex items-center gap-2 rounded-xl border border-emerald-700 px-3 py-2 text-sm text-emerald-300"><Check size={14} />Acknowledge</button><button disabled={saving} onClick={() => void act("snooze", item)} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300"><Clock3 size={14} />Snooze 1 Day</button></> : <button disabled={saving} onClick={() => void act(filter === "Snoozed" ? "unsnooze" : "reopen", item)} className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300">Return to Inbox</button>}</div></div></div>
              </article>
            ))}
          </div>
        )}
      </div>
    </TracePointShell>
  );
}
