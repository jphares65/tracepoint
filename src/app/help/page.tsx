"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  type HelpArticle,
  type HelpRole,
} from "./help-content";

const ROLE_OPTIONS: readonly ("All roles" | HelpRole)[] = [
  "All roles",
  "Officer",
  "Supervisor",
  "Administrator",
  "Platform Admin",
];

const QUICK_SEARCHES = [
  "Activate account",
  "Add officer",
  "Enter scores",
  "Missing Inbox alert",
] as const;

function searchableText(article: HelpArticle) {
  return [
    article.title,
    article.summary,
    article.category,
    ...article.roles,
    ...article.keywords,
    ...article.sections.flatMap((section) => [section.heading, ...section.steps]),
    article.tip ?? "",
  ].join(" ").toLowerCase();
}

function rankArticle(article: HelpArticle, query: string) {
  if (!query) return 1;
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const title = article.title.toLowerCase();
  const keywords = article.keywords.join(" ").toLowerCase();
  const haystack = searchableText(article);
  if (!terms.every((term) => haystack.includes(term))) return -1;
  return terms.reduce((score, term) => {
    if (title.includes(term)) score += 8;
    if (keywords.includes(term)) score += 4;
    return score + 1;
  }, 0);
}

export default function HelpCenterPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All topics");
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]>("All roles");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const results = useMemo(() => {
    return HELP_ARTICLES
      .map((article) => ({ article, score: rankArticle(article, query) }))
      .filter(({ article, score }) =>
        score >= 0 &&
        (category === "All topics" || article.category === category) &&
        (role === "All roles" || article.roles.includes(role)),
      )
      .sort((left, right) => right.score - left.score || left.article.title.localeCompare(right.article.title))
      .map(({ article }) => article);
  }, [category, query, role]);

  const selected = HELP_ARTICLES.find((article) => article.id === selectedId) ?? null;

  function openArticle(id: string) {
    setSelectedId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <TracePointShell activePage="Help Center">
      <div className="mx-auto w-full max-w-[1500px] space-y-6">
        {selected ? (
          <ArticleView article={selected} onBack={() => setSelectedId(null)} />
        ) : (
          <>
            <section className="overflow-hidden rounded-3xl border border-blue-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/50 px-6 py-9 shadow-2xl shadow-black/20 sm:px-10 sm:py-12">
              <div className="flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
                <div className="max-w-3xl">
                  <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-blue-300">
                    <CircleHelp size={14} /> TracePoint Help Center
                  </div>
                  <h1 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                    What can we help you do?
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                    Search every TracePoint workflow in plain language, then follow a focused guide tied to the live screen.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-700/80 bg-slate-950/50 px-5 py-4 text-sm text-slate-300">
                  <span className="block text-2xl font-bold text-white">{HELP_ARTICLES.length}</span>
                  searchable guides
                </div>
              </div>

              <div className="relative mt-8 max-w-4xl">
                <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-blue-300" size={21} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search: reset password, assign a firearm, import personnel..."
                  aria-label="Search TracePoint help"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 py-4 pl-12 pr-12 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                    <X size={18} />
                  </button>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {QUICK_SEARCHES.map((item) => (
                  <button key={item} type="button" onClick={() => setQuery(item)} className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-300 transition hover:border-blue-500/50 hover:text-blue-200">
                    {item}
                  </button>
                ))}
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
              <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
                <FilterBlock label="Topic">
                  {["All topics", ...HELP_CATEGORIES].map((item) => (
                    <button key={item} type="button" onClick={() => setCategory(item)} className={`w-full rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${category === item ? "bg-blue-600/20 text-blue-200" : "text-slate-400 hover:bg-slate-800/70 hover:text-white"}`}>
                      {item}
                    </button>
                  ))}
                </FilterBlock>
                <FilterBlock label="Guide for">
                  <select value={role} onChange={(event) => setRole(event.target.value as (typeof ROLE_OPTIONS)[number])} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500">
                    {ROLE_OPTIONS.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </FilterBlock>
              </aside>

              <div>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-400">Knowledge Base</p>
                    <h2 className="mt-1 text-xl font-bold text-white">{query ? `Results for “${query}”` : category}</h2>
                  </div>
                  <span className="text-xs text-slate-500">{results.length} {results.length === 1 ? "guide" : "guides"}</span>
                </div>

                {results.length ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {results.map((article) => (
                      <button key={article.id} type="button" onClick={() => openArticle(article.id)} className="group flex min-h-48 flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-500/40 hover:bg-slate-900">
                        <div className="flex items-start justify-between gap-3">
                          <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{article.category}</span>
                          {article.status === "Coming soon" && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">Coming soon</span>}
                        </div>
                        <h3 className="mt-4 text-base font-bold text-white group-hover:text-blue-200">{article.title}</h3>
                        <p className="mt-2 flex-1 text-sm leading-6 text-slate-400">{article.summary}</p>
                        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-800 pt-4">
                          <span className="truncate text-[11px] text-slate-500">{article.roles.join(" · ")}</span>
                          <ArrowRight size={17} className="shrink-0 text-blue-400 transition group-hover:translate-x-1" />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 px-6 py-14 text-center">
                    <Search className="mx-auto text-slate-600" size={28} />
                    <h3 className="mt-4 font-bold text-white">No matching guide</h3>
                    <p className="mt-2 text-sm text-slate-400">Try fewer words, another role, or All topics.</p>
                    <button type="button" onClick={() => { setQuery(""); setCategory("All topics"); setRole("All roles"); }} className="mt-5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500">Clear filters</button>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </TracePointShell>
  );
}

function FilterBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
      <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ArticleView({ article, onBack }: { article: HelpArticle; onBack: () => void }) {
  return (
    <article className="mx-auto max-w-5xl">
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-white">
        <ArrowLeft size={17} /> Back to all guides
      </button>

      <header className="rounded-3xl border border-blue-500/20 bg-gradient-to-br from-slate-900 to-blue-950/40 p-6 sm:p-9">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-300">{article.category}</span>
          {article.status === "Coming soon" && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">Coming soon</span>}
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-white">{article.title}</h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-300">{article.summary}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {article.roles.map((item) => <span key={item} className="rounded-lg bg-slate-950/50 px-2.5 py-1 text-[11px] text-slate-400">{item}</span>)}
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-5">
          {article.sections.map((section) => (
            <section key={section.heading} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300"><BookOpen size={18} /></div>
                <h2 className="text-lg font-bold text-white">{section.heading}</h2>
              </div>
              <ol className="mt-5 space-y-4">
                {section.steps.map((step, index) => (
                  <li key={step} className="flex gap-3 text-sm leading-6 text-slate-300">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10 text-[11px] font-bold text-blue-300">{index + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}

          {article.tip && (
            <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5">
              <div className="flex gap-3">
                <Sparkles className="mt-0.5 shrink-0 text-emerald-300" size={19} />
                <div><h2 className="text-sm font-bold text-emerald-200">Good to know</h2><p className="mt-1 text-sm leading-6 text-slate-300">{article.tip}</p></div>
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          {article.route && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Try it in TracePoint</p>
              <Link href={article.route} className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-500">
                {article.routeLabel ?? "Open Page"} <ExternalLink size={16} />
              </Link>
            </div>
          )}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <CheckCircle2 size={19} className="text-blue-300" />
            <h2 className="mt-3 text-sm font-bold text-white">Still not resolved?</h2>
            <p className="mt-2 text-xs leading-5 text-slate-400">Capture the department, person or record, what you expected, what occurred, and the approximate time. Do not include passwords or security links.</p>
          </div>
        </aside>
      </div>
    </article>
  );
}
