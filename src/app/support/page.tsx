import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support | TracePoint Public Safety",
  description:
    "Contact TracePoint support or sign in to access in-app support for your agency.",
};

export default function SupportPage() {
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
            href="/login"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <div id="main-content">
        <section
          aria-labelledby="support-heading"
          className="relative isolate overflow-hidden"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,rgba(37,99,235,0.18),transparent_42%)]"
          />
          <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-28">
            <h1
              id="support-heading"
              className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl"
            >
              TracePoint Public Safety
              <span className="block text-blue-400 sm:inline"> &mdash; Support</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
              Support is available to authorized public safety agency personnel
              using TracePoint.
            </p>

            <div className="mt-10 rounded-2xl border border-slate-700/80 bg-slate-900/70 p-6 shadow-2xl shadow-black/20 sm:p-8">
              <h2 className="text-lg font-semibold text-white">
                Contact TracePoint support
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                For help using TracePoint, contact our support team by email.
              </p>
              <a
                href="mailto:support@tracepointhq.com"
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-slate-900"
              >
                Email support
              </a>
              <p className="mt-3 break-all text-sm text-slate-400">
                <a
                  href="mailto:support@tracepointhq.com"
                  className="underline decoration-slate-500 underline-offset-4 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-300"
                >
                  support@tracepointhq.com
                </a>
              </p>
            </div>

            <div className="mt-8 border-t border-white/10 pt-6">
              <h2 className="text-base font-semibold text-white">
                Already using TracePoint?
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Sign in to your account and use the existing in-app support
                options for your agency.
              </p>
              <Link
                href="/login"
                className="mt-4 inline-flex min-h-11 items-center rounded-lg px-1 py-2 text-sm font-semibold text-blue-300 underline decoration-blue-400/50 underline-offset-4 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                Sign in to TracePoint
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
