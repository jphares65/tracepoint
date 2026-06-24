import Image from "next/image";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import LoginForm from "./LoginForm";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
};

function safeNextPath(value?: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

export default async function LoginPage({
  searchParams,
}: LoginPageProps) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claims?.sub) {
    redirect(`/auth/setup?next=${encodeURIComponent(nextPath)}`);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-12rem] top-[-12rem] h-[34rem] w-[34rem] rounded-full bg-blue-600/10 blur-3xl" />
        <div className="absolute bottom-[-14rem] right-[-10rem] h-[38rem] w-[38rem] rounded-full bg-cyan-500/5 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(30,41,59,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(30,41,59,0.16)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      <div className="relative mx-auto grid min-h-screen w-full max-w-7xl items-center gap-12 px-5 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:px-10">
        <section className="hidden lg:block">
          <Image
            src="/tracepoint-logo-dark.png"
            alt="TracePoint"
            width={320}
            height={80}
            priority
            className="h-auto w-[320px] object-contain"
          />

          <p className="mt-8 max-w-xl text-4xl font-semibold leading-tight tracking-tight text-slate-100">
            Operational accountability for firearms, training, and readiness.
          </p>

          <p className="mt-5 max-w-xl text-base leading-7 text-slate-400">
            TracePoint centralizes range activity, qualification history,
            firearm accountability, inspections, approvals, and command-level
            compliance visibility.
          </p>

          <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
            {[
              ["Secure", "Department-scoped access"],
              ["Auditable", "Documented actions"],
              ["Operational", "Built for range staff"],
            ].map(([title, description]) => (
              <div
                key={title}
                className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4"
              >
                <p className="text-sm font-semibold text-slate-200">{title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-md">
          <div className="mb-7 lg:hidden">
            <Image
              src="/tracepoint-logo-dark.png"
              alt="TracePoint"
              width={230}
              height={58}
              priority
              className="h-auto w-[220px] object-contain"
            />
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/30 backdrop-blur sm:p-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-blue-400">
                Secure access
              </p>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">
                Sign in to TracePoint
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Use the account issued by your department administrator.
              </p>
            </div>

            {params.error ? (
              <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {params.error}
              </div>
            ) : null}

            <LoginForm nextPath={nextPath} />
          </div>

          <p className="mt-5 text-center text-xs leading-5 text-slate-600">
            TracePoint is an authorized-use system. Activity may be logged for
            accountability and security.
          </p>
        </section>
      </div>
    </main>
  );
}
