import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { assertPolicyPublishable, policyEffectiveDate, policyIntro, policySections } from "./policy-content";

export const metadata: Metadata = {
  title: "Privacy Policy | TracePoint Public Safety",
  description:
    "How TracePoint collects, uses, shares, and protects information in TracePoint Public Safety.",
};

export default function PrivacyPage() {
  assertPolicyPublishable(process.env.NODE_ENV);
  return (
    <main className="min-h-screen bg-[#070b12] text-slate-100 selection:bg-blue-500/30">
      <a
        href="#main-content"
        className="sr-only z-50 rounded bg-white px-4 py-2 text-slate-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      <header className="border-b border-white/5 bg-[#070b12]/85 backdrop-blur-xl">
        <nav
          aria-label="Primary navigation"
          className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8"
        >
          <Link href="/landing" aria-label="TracePoint home">
            <Image
              src="/tracepoint-logo-dark.png"
              alt="TracePoint"
              width={220}
              height={55}
              priority
              className="h-auto w-36 sm:w-52"
            />
          </Link>
          <Link
            href="/support"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            Support
          </Link>
        </nav>
      </header>

      <div id="main-content" className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
        <article aria-labelledby="privacy-heading">
          <h1 id="privacy-heading" className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-slate-400">TracePoint Public Safety &middot; Effective {policyEffectiveDate}</p>

          <div className="mt-8 space-y-4 text-base leading-7 text-slate-300">
            {policyIntro.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
          </div>

          {policySections.map(section => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="mt-10 border-t border-white/10 pt-8">
              <h2 id={`${section.id}-heading`} className="text-xl font-semibold text-white">{section.heading}</h2>
              {section.paragraphs?.map(paragraph => (
                <p key={paragraph} className="mt-4 text-base leading-7 text-slate-300">{paragraph}</p>
              ))}
              {section.items ? (
                <ul className="mt-4 list-disc space-y-2 pl-6 text-base leading-7 text-slate-300">
                  {section.items.map(item => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
              {section.closing?.map(paragraph => (
                <p key={paragraph} className="mt-4 text-base leading-7 text-slate-300">{paragraph}</p>
              ))}
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}
