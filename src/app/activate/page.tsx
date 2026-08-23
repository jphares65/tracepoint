import Image from "next/image";
import { redirect } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";

import {
  ACTIVATION_VALID_DAYS,
  completeActivation,
  validateActivationToken,
} from "@/lib/tracepoint/activation";
import { createClient } from "@/lib/supabase/server";

type ActivatePageProps = {
  searchParams: Promise<{
    token?: string;
    error?: string;
  }>;
};

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function redirectWithError(token: string, message: string): never {
  redirect(
    `/activate?token=${encodeURIComponent(
      token,
    )}&error=${encodeURIComponent(message)}`,
  );
}

async function activateAccount(formData: FormData) {
  "use server";

  const token = textValue(formData, "token");
  const password = textValue(formData, "password");
  const confirmPassword = textValue(formData, "confirmPassword");

  if (!token) {
    redirect("/login?error=Activation link is missing.");
  }

  if (password.length < 8) {
    redirectWithError(
      token,
      "Password must be at least 8 characters.",
    );
  }

  if (password !== confirmPassword) {
    redirectWithError(token, "Passwords do not match.");
  }

  let result: Awaited<ReturnType<typeof completeActivation>>;

  try {
    result = await completeActivation(token, password);
  } catch (error) {
    redirectWithError(
      token,
      error instanceof Error
        ? error.message
        : "Account activation could not be completed.",
    );
  }

  const supabase = await createClient();
  const { error: signInError } =
    await supabase.auth.signInWithPassword({
      email: result.email,
      password,
    });

  if (signInError) {
    redirect(
      `/login?error=${encodeURIComponent(
        "Your account was activated. Please sign in with your new password.",
      )}`,
    );
  }

  redirect("/");
}

export default async function ActivatePage({
  searchParams,
}: ActivatePageProps) {
  const params = await searchParams;
  const token = params.token?.trim() ?? "";

  let valid = false;
  let expiration = "";
  let validationError = "";

  if (token) {
    try {
      const validation = await validateActivationToken(token);
      valid = true;
      expiration = new Date(
        validation.row.expires_at,
      ).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (error) {
      validationError =
        error instanceof Error
          ? error.message
          : "This activation link is invalid.";
    }
  } else {
    validationError = "This activation link is incomplete.";
  }

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-white">
      <div className="mx-auto w-full max-w-xl">
        <Image
          src="/tracepoint-logo-dark.png"
          alt="TracePoint"
          width={240}
          height={60}
          priority
          className="h-auto w-[220px] object-contain"
        />

        <section className="mt-9 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/20 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-2.5 text-blue-400">
              <KeyRound size={20} />
            </span>
            <div>
              <h1 className="text-xl font-semibold">
                Activate your TracePoint account
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Create your password to complete account setup.
              </p>
            </div>
          </div>

          {!valid ? (
            <div className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              {validationError}
            </div>
          ) : (
            <>
              <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                This single-use invitation is valid through {expiration}.
                TracePoint activation invitations remain available for{" "}
                {ACTIVATION_VALID_DAYS} days.
              </div>

              {params.error ? (
                <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                  {params.error}
                </div>
              ) : null}

              <form action={activateAccount} className="mt-7 space-y-5">
                <input type="hidden" name="token" value={token} />

                <label className="block">
                  <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                    New password
                  </span>
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                    Confirm password
                  </span>
                  <input
                    name="confirmPassword"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none focus:border-blue-500"
                  />
                </label>

                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white hover:bg-blue-500"
                >
                  <ShieldCheck size={17} />
                  Activate account
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}