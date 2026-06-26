import Link from "next/link";
import {
  ArrowLeft,
  Home,
  LockKeyhole,
  LogOut,
} from "lucide-react";

type UnauthorizedPageProps = {
  searchParams: Promise<{
    from?: string;
  }>;
};

export default async function UnauthorizedPage({
  searchParams,
}: UnauthorizedPageProps) {
  const params = await searchParams;
  const attemptedPath = params.from?.startsWith("/")
    ? params.from
    : "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 py-10 text-white">
      <section className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/80 p-7 text-center shadow-2xl shadow-black/30 sm:p-9">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-300">
          <LockKeyhole size={25} />
        </div>

        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">
          Access restricted
        </p>

        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Your TracePoint role does not permit this page.
        </h1>

        <p className="mt-3 text-sm leading-6 text-slate-400">
          Access is determined by your department membership and assigned
          operational roles.
        </p>

        {attemptedPath ? (
          <p className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 font-mono text-xs text-slate-500">
            {attemptedPath}
          </p>
        ) : null}

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold transition hover:bg-blue-500"
          >
            <Home size={16} />
            Return home
          </Link>

          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-sm font-semibold text-slate-300 transition hover:border-slate-600 hover:text-white"
            >
              <LogOut size={16} />
              Sign in as another user
            </button>
          </form>
        </div>

        <Link
          href="/"
          className="mt-5 inline-flex items-center gap-1 text-xs text-slate-600 transition hover:text-slate-300"
        >
          <ArrowLeft size={13} />
          Back to My TracePoint
        </Link>
      </section>
    </main>
  );
}
