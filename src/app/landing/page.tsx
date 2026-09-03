import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BellRing,
  Boxes,
  Building2,
  CarFront,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileBarChart,
  Gauge,
  Network,
  Radio,
  ShieldCheck,
  Siren,
  Users,
  Wrench,
} from "lucide-react";

export const metadata: Metadata = {
  title: "TracePoint | Operational Readiness for Public Safety",
  description:
    "Turn personnel, equipment, fleet, training, and accountability records into clear operational readiness for every level of your agency.",
};

const readiness = [
  {
    icon: Users,
    label: "People",
    title: "Know who is ready for duty.",
    body: "Bring training, certifications, qualifications, assignments, and expiring requirements into one current view.",
    accent: "text-blue-300",
    glow: "bg-blue-500/10",
  },
  {
    icon: Boxes,
    label: "Equipment",
    title: "Track custody and condition.",
    body: "Manage inventory, officer and vehicle assignments, inspections, expirations, and readiness exceptions.",
    accent: "text-cyan-300",
    glow: "bg-cyan-500/10",
  },
  {
    icon: CarFront,
    label: "Fleet",
    title: "Keep vehicles mission-capable.",
    body: "Connect inspections, maintenance, work orders, documents, and installed equipment to each vehicle.",
    accent: "text-emerald-300",
    glow: "bg-emerald-500/10",
  },
];

const capabilities = [
  {
    icon: BadgeCheck,
    title: "Training & certifications",
    body: "See current, due-soon, expired, and missing requirements by officer, unit, or department.",
  },
  {
    icon: ShieldCheck,
    title: "Armory & range operations",
    body: "Manage firearms, ammunition, inspections, qualifications, and complete Digital Range Packets.",
  },
  {
    icon: Boxes,
    title: "Equipment accountability",
    body: "Track inventory, assignments, service status, inspections, and the history behind every handoff.",
  },
  {
    icon: CarFront,
    title: "Fleet management",
    body: "Coordinate vehicle readiness, inspections, maintenance, work orders, documents, and vehicle equipment.",
  },
  {
    icon: BellRing,
    title: "Officer Inbox",
    body: "Bring approvals, deadlines, deficiencies, and follow-up actions into a focused personal queue.",
  },
  {
    icon: FileBarChart,
    title: "Standards & reporting",
    body: "Configure agency rules and permissions, import existing records, and produce useful operational reports.",
  },
];

function StatusDot({ tone }: { tone: "good" | "warn" | "alert" }) {
  const color = tone === "good" ? "bg-emerald-400" : tone === "warn" ? "bg-amber-400" : "bg-rose-400";
  return <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden="true" />;
}

function CommandPreview() {
  return (
    <div className="relative mx-auto w-full max-w-2xl" aria-label="Illustration of the TracePoint command readiness interface">
      <div className="absolute -inset-8 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="relative overflow-hidden rounded-[1.75rem] border border-slate-700/80 bg-slate-950 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600"><Activity size={16} /></span>
            <div><p className="text-xs font-bold text-white">Command Readiness</p><p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">Operational picture</p></div>
          </div>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-emerald-300">Live records</span>
        </div>
        <div className="grid gap-2 p-3 sm:grid-cols-3 sm:p-4">
          {[["Personnel", "Ready", "good"], ["Equipment", "3 actions", "warn"], ["Fleet", "1 exception", "alert"]].map(([label, value, tone]) => (
            <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="flex items-center gap-2"><StatusDot tone={tone as "good" | "warn" | "alert"} /><span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span></div>
              <p className="mt-2 text-sm font-bold text-slate-100">{value}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-3 px-3 pb-3 sm:grid-cols-[1.35fr_0.65fr] sm:px-4 sm:pb-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="flex items-center justify-between"><p className="text-xs font-semibold text-white">Readiness exceptions</p><p className="text-[9px] text-blue-300">View all</p></div>
            <div className="mt-3 space-y-2">
              {[["Certification renewal due", "Training", "warn"], ["Vehicle inspection follow-up", "Fleet", "alert"], ["Equipment reassignment complete", "Equipment", "good"]].map(([title, source, tone]) => (
                <div key={title} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5">
                  <StatusDot tone={tone as "good" | "warn" | "alert"} />
                  <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium text-slate-200">{title}</p><p className="text-[9px] text-slate-600">{source}</p></div>
                  <ChevronRight size={12} className="text-slate-600" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-xs font-semibold text-white">Action queue</p>
            <div className="mt-4 grid place-items-center"><div className="grid h-24 w-24 place-items-center rounded-full border-[9px] border-blue-500/20 border-t-blue-400"><div className="text-center"><p className="text-2xl font-bold text-white">6</p><p className="text-[8px] uppercase tracking-wider text-slate-500">Open</p></div></div></div>
            <p className="mt-4 text-center text-[10px] leading-4 text-slate-500">Prioritized for the people responsible.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#070b12] text-slate-100 selection:bg-blue-500/30">
      <a href="#main-content" className="sr-only z-50 rounded bg-white px-4 py-2 text-slate-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>

      <header className="relative z-20 border-b border-white/5 bg-[#070b12]/85 backdrop-blur-xl">
        <nav aria-label="Primary navigation" className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/landing" aria-label="TracePoint home">
            <Image src="/tracepoint-logo-dark.png" alt="TracePoint" width={220} height={55} priority className="h-auto w-36 sm:w-52" />
          </Link>
          <div className="hidden items-center gap-7 md:flex">
            <a href="#readiness" className="text-sm text-slate-400 transition hover:text-white">Readiness</a>
            <a href="#capabilities" className="text-sm text-slate-400 transition hover:text-white">Capabilities</a>
            <a href="#integrations" className="text-sm text-slate-400 transition hover:text-white">Integrations</a>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/login" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 transition hover:text-white sm:block">Sign in</Link>
            <a href="#demo" className="rounded-xl bg-blue-600 px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-300 sm:px-5"><span className="sm:hidden">Demo</span><span className="hidden sm:inline">Request a Demo</span></a>
          </div>
        </nav>
      </header>

      <div id="main-content">
        <section className="relative border-b border-white/5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_15%,rgba(37,99,235,0.18),transparent_28%),radial-gradient(circle_at_85%_40%,rgba(14,165,233,0.10),transparent_30%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(51,65,85,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(51,65,85,0.10)_1px,transparent_1px)] bg-[size:56px_56px]" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.92fr_1.08fr] lg:py-32">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-300"><Siren size={13} /> Public safety operational readiness</div>
              <h1 className="mt-7 max-w-3xl text-4xl font-bold leading-[1.06] tracking-[-0.04em] text-white sm:text-6xl lg:text-[4.25rem]">Know what is ready.<br /><span className="text-blue-400">Act on what is not.</span></h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg sm:leading-8">TracePoint turns scattered personnel, vehicle, and equipment records into a clear operational picture—so officers, supervisors, and command staff can resolve readiness gaps before they affect the mission.</p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <a href="#demo" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-bold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-300">Request a Demo <ArrowRight size={16} /></a>
                <a href="#capabilities" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/50 px-6 py-3.5 text-sm font-bold text-slate-200 transition hover:border-slate-500 hover:bg-slate-900">Explore Capabilities <ChevronRight size={16} /></a>
              </div>
              <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-slate-500"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" /> Built to complement the systems and policies your agency already relies on.</p>
            </div>
            <CommandPreview />
          </div>
        </section>

        <section id="readiness" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl"><p className="text-xs font-bold uppercase tracking-[0.22em] text-blue-400">Readiness, not recordkeeping</p><h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl">One operational picture across your agency.</h2><p className="mt-5 text-base leading-7 text-slate-400 sm:text-lg">A record can exist and still be incomplete, expired, overdue, or out of service. TracePoint connects those details to the people and resources they affect.</p></div>
            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {readiness.map(({ icon: Icon, label, title, body, accent, glow }) => (
                <article key={label} className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/45 p-6 transition hover:-translate-y-1 hover:border-slate-700 sm:p-7">
                  <div className={`absolute right-0 top-0 h-32 w-32 rounded-full ${glow} blur-3xl`} />
                  <div className={`relative grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-slate-950 ${accent}`}><Icon size={21} /></div>
                  <p className={`relative mt-6 text-xs font-bold uppercase tracking-[0.18em] ${accent}`}>{label}</p><h3 className="relative mt-2 text-xl font-bold text-white">{title}</h3><p className="relative mt-3 text-sm leading-6 text-slate-400">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="capabilities" className="scroll-mt-20 border-y border-white/5 bg-slate-950/50 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="grid gap-14 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
              <div className="lg:sticky lg:top-28"><p className="text-xs font-bold uppercase tracking-[0.22em] text-blue-400">Connected operations</p><h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl">From the range to the motor pool.</h2><p className="mt-5 text-base leading-7 text-slate-400">Purpose-built workflows share one agency context, one permission model, and one accountability trail.</p></div>
              <div className="grid gap-px overflow-hidden rounded-2xl border border-slate-800 bg-slate-800 sm:grid-cols-2">
                {capabilities.map(({ icon: Icon, title, body }) => <article key={title} className="bg-[#0a101a] p-6 sm:p-7"><Icon size={21} className="text-blue-300" /><h3 className="mt-5 text-base font-bold text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{body}</p></article>)}
              </div>
            </div>
          </div>
        </section>

        <section className="py-20 sm:py-28">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-2 lg:items-center">
            <div className="order-2 lg:order-1">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4 shadow-2xl shadow-black/30 sm:p-6">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4"><div><p className="text-sm font-bold text-white">Officer Inbox</p><p className="mt-1 text-[10px] text-slate-500">Actions across TracePoint</p></div><span className="rounded-full bg-rose-500/10 px-2.5 py-1 text-[9px] font-bold text-rose-300">2 priority</span></div>
                <div className="mt-4 space-y-3">
                  {[[ClipboardCheck, "Inspection follow-up", "Equipment", "Due today"], [BadgeCheck, "Certification renewal", "Training", "Due soon"], [Wrench, "Work order review", "Fleet", "Assigned"]].map(([Icon, title, source, status]) => { const ItemIcon = Icon as typeof ClipboardCheck; return <div key={String(title)} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-300"><ItemIcon size={17} /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-white">{String(title)}</p><p className="mt-1 text-[9px] uppercase tracking-wider text-slate-600">{String(source)}</p></div><span className="text-[10px] font-medium text-slate-400">{String(status)}</span></div>; })}
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2"><p className="text-xs font-bold uppercase tracking-[0.22em] text-blue-400">From awareness to action</p><h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl">Give every level the view it needs.</h2><p className="mt-5 text-base leading-7 text-slate-400">Officers see their assignments and deadlines. Supervisors see exceptions that need follow-up. Command staff see department-wide readiness without assembling another spreadsheet.</p><div className="mt-7 space-y-4">{[[BellRing, "One queue for approvals, expirations, deficiencies, and assigned work"], [Gauge, "Command dashboards for readiness trends and operational exceptions"], [Building2, "Agency-defined standards, roles, permissions, and reporting"]].map(([Icon, text]) => { const ItemIcon = Icon as typeof BellRing; return <div key={String(text)} className="flex gap-3"><ItemIcon size={18} className="mt-0.5 shrink-0 text-blue-300" /><p className="text-sm leading-6 text-slate-300">{String(text)}</p></div>; })}</div></div>
          </div>
        </section>

        <section id="integrations" className="scroll-mt-20 border-y border-blue-400/10 bg-blue-950/15 py-20 sm:py-24">
          <div className="mx-auto grid max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[1fr_0.8fr] lg:items-center">
            <div><div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-cyan-300"><Network size={15} /> Integration vision</div><h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl">The readiness layer around your core systems.</h2><p className="mt-5 max-w-3xl text-base leading-7 text-slate-400">TracePoint is designed to complement—not replace—CAD/RMS and policy or accreditation platforms. Future integrations can make verified readiness available where operational decisions are made while preserving each system&apos;s role as a source of record.</p><p className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-amber-100/70"><strong className="font-semibold text-amber-200">Roadmap:</strong> CAD/RMS connectivity and AI-assisted operational recommendations are integration concepts and demonstrations, not currently represented as live production integrations.</p></div>
            <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]" aria-label="Diagram showing TracePoint connecting agency systems to readiness views">
              <div className="space-y-3">{["CAD / RMS", "Policy", "Accreditation"].map((label) => <div key={label} className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-center text-xs font-semibold text-slate-300">{label}</div>)}</div>
              <Radio size={22} className="mx-auto rotate-90 text-cyan-300 sm:rotate-0" aria-hidden="true" />
              <div className="rounded-2xl border border-blue-400/30 bg-blue-500/10 p-5 text-center"><Activity size={24} className="mx-auto text-blue-300" /><p className="mt-3 text-sm font-bold text-white">TracePoint</p><p className="mt-1 text-[10px] leading-4 text-slate-400">Operational readiness</p></div>
            </div>
          </div>
        </section>

        <section id="demo" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-5xl px-5 text-center sm:px-8"><div className="rounded-[2rem] border border-blue-400/20 bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.20),transparent_55%)] px-6 py-14 sm:px-12 sm:py-20"><p className="text-xs font-bold uppercase tracking-[0.22em] text-blue-300">See the complete operational picture</p><h2 className="mx-auto mt-4 max-w-3xl text-3xl font-bold tracking-tight text-white sm:text-5xl">Move from scattered records to readiness you can act on.</h2><p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-400">Explore how TracePoint can bring your agency&apos;s people, equipment, fleet, and accountability workflows together.</p><div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-bold text-white transition hover:bg-blue-500">Request a Demo <ArrowRight size={16} /></Link><Link href="/login" className="inline-flex items-center justify-center rounded-xl border border-slate-700 px-6 py-3.5 text-sm font-bold text-slate-200 transition hover:border-slate-500">Agency Sign In</Link></div></div></div>
        </section>
      </div>

      <footer className="border-t border-white/5 py-8"><div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-5 text-center sm:flex-row sm:px-8 sm:text-left"><Image src="/tracepoint-logo-dark.png" alt="TracePoint" width={160} height={40} className="h-auto w-36 opacity-80" /><p className="text-xs text-slate-600">Operational readiness and accountability for public safety.</p></div></footer>
    </main>
  );
}
