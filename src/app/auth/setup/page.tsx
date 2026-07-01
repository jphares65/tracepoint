import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  Building2,
  Database,
  KeyRound,
  ShieldCheck,
  Users,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";

type SetupPageProps = {
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

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function setupRedirectWithError(message: string, nextPath: string) {
  redirect(
    `/auth/setup?error=${encodeURIComponent(
      message,
    )}&next=${encodeURIComponent(nextPath)}`,
  );
}

async function completeAccountSetup(formData: FormData) {
  "use server";

  const nextPath = safeNextPath(textValue(formData, "next"));
  const password = textValue(formData, "password");
  const confirmPassword = textValue(formData, "confirmPassword");

  if (!password || !confirmPassword) {
    setupRedirectWithError("Password and confirmation are required.", nextPath);
  }

  if (password.length < 8) {
    setupRedirectWithError(
      "Password must be at least 8 characters.",
      nextPath,
    );
  }

  if (password !== confirmPassword) {
    setupRedirectWithError("Passwords do not match.", nextPath);
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect(`/login?next=${encodeURIComponent("/auth/setup")}`);
  }

  const { error } = await supabase.auth.updateUser({
    password,
  });

  if (error) {
    setupRedirectWithError(error.message, nextPath);
  }

  redirect(nextPath);
}

async function createInitialDepartment(formData: FormData) {
  "use server";

  const nextPath = safeNextPath(textValue(formData, "next"));
  const name = textValue(formData, "departmentName");
  const shortName = textValue(formData, "shortName");
  const slug = textValue(formData, "slug")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const badgeNumber = textValue(formData, "badgeNumber");
  const rankTitle = textValue(formData, "rankTitle");
  const unitName = textValue(formData, "unitName");

  if (!name || !slug) {
    setupRedirectWithError(
      "Department name and identifier are required.",
      nextPath,
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login");
  }

  const { error } = await supabase.rpc("create_department_with_owner", {
    p_name: name,
    p_slug: slug,
    p_short_name: shortName || null,
    p_badge_number: badgeNumber || null,
    p_rank_title: rankTitle || null,
    p_unit_name: unitName || null,
  });

  if (error) {
    setupRedirectWithError(error.message, nextPath);
  }

  redirect(nextPath);
}

function SetupShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 px-5 py-10 text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-10rem] top-[-12rem] h-[34rem] w-[34rem] rounded-full bg-blue-600/10 blur-3xl" />
        <div className="absolute bottom-[-16rem] right-[-10rem] h-[38rem] w-[38rem] rounded-full bg-cyan-500/5 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-5xl">
        <div className="flex items-center justify-between gap-4">
          <Image
            src="/tracepoint-logo-dark.png"
            alt="TracePoint"
            width={240}
            height={60}
            priority
            className="h-auto w-[220px] object-contain"
          />

          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-2 text-xs font-semibold text-slate-400 transition hover:border-slate-700 hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>

        {children}
      </div>
    </main>
  );
}

function ErrorNotice({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
      {message}
    </div>
  );
}

function PasswordSetupView({
  error,
  nextPath,
}: {
  error?: string;
  nextPath: string;
}) {
  return (
    <SetupShell>
      <div className="mt-9 grid gap-7 lg:grid-cols-[0.85fr_1.15fr]">
        <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-blue-400">
            Account setup
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Secure your TracePoint account
          </h1>
          <p className="mt-4 text-sm leading-6 text-slate-400">
            Your department membership is already active. Set or update your
            password to finish account setup and continue into TracePoint.
          </p>

          <div className="mt-8 space-y-4">
            {[
              [
                KeyRound,
                "Password setup",
                "Creates or updates your TracePoint login password",
              ],
              [
                Building2,
                "Department access",
                "Uses your existing department membership",
              ],
              [
                ShieldCheck,
                "Role-based permissions",
                "Applies the access assigned by your administrator",
              ],
              [
                Database,
                "Operational records",
                "Keeps activity tied to your authenticated account",
              ],
            ].map(([Icon, title, description]) => {
              const ItemIcon = Icon as typeof Building2;

              return (
                <div
                  key={title as string}
                  className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4"
                >
                  <span className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-2 text-blue-400">
                    <ItemIcon size={17} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-200">
                      {title as string}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {description as string}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/20 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-emerald-400">
              <BadgeCheck size={20} />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-white">
                Set your password
              </h2>
              <p className="text-sm text-slate-500">
                Use at least 8 characters.
              </p>
            </div>
          </div>

          <ErrorNotice message={error} />

          <form action={completeAccountSetup} className="mt-7 space-y-5">
            <input type="hidden" name="next" value={nextPath} />

            <label className="block">
              <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                New password
              </span>
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-700 focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                Confirm password
              </span>
              <input
                name="confirmPassword"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-700 focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10"
              />
            </label>

            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              <ShieldCheck size={17} />
              Save password and continue
            </button>

            <Link
              href={nextPath}
              className="block text-center text-xs font-semibold text-slate-500 transition hover:text-slate-300"
            >
              Continue to TracePoint
            </Link>
          </form>
        </section>
      </div>
    </SetupShell>
  );
}

function InitialDepartmentSetupView({
  error,
  nextPath,
}: {
  error?: string;
  nextPath: string;
}) {
  return (
    <SetupShell>
      <div className="mt-9 grid gap-7 lg:grid-cols-[0.85fr_1.15fr]">
        <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-blue-400">
            Initial configuration
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Establish your TracePoint department
          </h1>
          <p className="mt-4 text-sm leading-6 text-slate-400">
            This creates the first secure tenant and assigns your signed-in
            account as its administrator.
          </p>

          <div className="mt-8 space-y-4">
            {[
              [Building2, "Department tenant", "Separates agency records"],
              [Users, "Administrator membership", "Creates your first role"],
              [ShieldCheck, "RLS enforcement", "Applies department access"],
              [Database, "Shared data", "Replaces browser-only storage"],
            ].map(([Icon, title, description]) => {
              const ItemIcon = Icon as typeof Building2;

              return (
                <div
                  key={title as string}
                  className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4"
                >
                  <span className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-2 text-blue-400">
                    <ItemIcon size={17} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-200">
                      {title as string}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {description as string}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/20 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-emerald-400">
              <BadgeCheck size={20} />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-white">
                Readington pilot setup
              </h2>
              <p className="text-sm text-slate-500">
                Review the values before creating the department.
              </p>
            </div>
          </div>

          <ErrorNotice message={error} />

          <form action={createInitialDepartment} className="mt-7 space-y-5">
            <input type="hidden" name="next" value={nextPath} />

            <div className="grid gap-5 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                  Department name
                </span>
                <input
                  name="departmentName"
                  required
                  defaultValue="Readington Township Police Department"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-700 focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10"
                />
              </label>

              <label>
                <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                  Short name
                </span>
                <input
                  name="shortName"
                  defaultValue="Readington PD"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10"
                />
              </label>

              <label>
                <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                  Department identifier
                </span>
                <input
                  name="slug"
                  required
                  defaultValue="readington-pd"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10"
                />
              </label>

              <label>
                <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                  Badge number
                </span>
                <input
                  name="badgeNumber"
                  placeholder="Optional"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-700 focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10"
                />
              </label>

              <label>
                <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                  Rank / title
                </span>
                <input
                  name="rankTitle"
                  defaultValue="Lieutenant"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10"
                />
              </label>

              <label className="sm:col-span-2">
                <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                  Unit / assignment
                </span>
                <input
                  name="unitName"
                  defaultValue="Special Services"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10"
                />
              </label>
            </div>

            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              <ShieldCheck size={17} />
              Create department and continue
            </button>
          </form>
        </section>
      </div>
    </SetupShell>
  );
}

export default async function SetupPage({
  searchParams,
}: SetupPageProps) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);

  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect(`/login?next=${encodeURIComponent("/auth/setup")}`);
  }

  const { data: membership } = await supabase
    .from("department_memberships")
    .select("department_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membership?.department_id) {
    return (
      <PasswordSetupView
        error={params.error}
        nextPath={nextPath}
      />
    );
  }

  return (
    <InitialDepartmentSetupView
      error={params.error}
      nextPath={nextPath}
    />
  );
}