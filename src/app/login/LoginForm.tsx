"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type LoginFormProps = {
  nextPath: string;
};

export default function LoginForm({ nextPath }: LoginFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busyAction, setBusyAction] = useState<"password" | "link" | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const setupPath = `/auth/setup?next=${encodeURIComponent(nextPath)}`;

  async function signInWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("password");
    setMessage(null);
    setIsError(false);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setBusyAction(null);
      setIsError(true);
      setMessage(error.message);
      return;
    }

    router.replace(setupPath);
    router.refresh();
  }

  async function sendSignInLink() {
    if (!email.trim()) {
      setIsError(true);
      setMessage("Enter your email address first.");
      return;
    }

    setBusyAction("link");
    setMessage(null);
    setIsError(false);

    const callbackNext = `/auth/setup?next=${encodeURIComponent(nextPath)}`;
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
      callbackNext,
    )}`;

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo,
        shouldCreateUser: false,
      },
    });

    setBusyAction(null);

    if (error) {
      setIsError(true);
      setMessage(error.message);
      return;
    }

    setIsError(false);
    setMessage(
      "A secure sign-in link was sent. Check your email and return through that link.",
    );
  }

  return (
    <div className="mt-7">
      <form onSubmit={signInWithPassword} className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
            Email
          </span>
          <span className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 transition focus-within:border-blue-500/70 focus-within:ring-2 focus-within:ring-blue-500/10">
            <Mail size={17} className="text-slate-500" />
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@department.gov"
              className="min-w-0 flex-1 bg-transparent py-3.5 text-sm text-white outline-none placeholder:text-slate-700"
            />
          </span>
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
            Password
          </span>
          <span className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 transition focus-within:border-blue-500/70 focus-within:ring-2 focus-within:ring-blue-500/10">
            <LockKeyhole size={17} className="text-slate-500" />
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              className="min-w-0 flex-1 bg-transparent py-3.5 text-sm text-white outline-none placeholder:text-slate-700"
            />
          </span>
        </label>

        {message ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm leading-5 ${
              isError
                ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            }`}
          >
            {message}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={busyAction !== null}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busyAction === "password" ? (
            <Loader2 size={17} className="animate-spin" />
          ) : (
            <ArrowRight size={17} />
          )}
          Sign in
        </button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-800" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">
          or
        </span>
        <div className="h-px flex-1 bg-slate-800" />
      </div>

      <button
        type="button"
        onClick={sendSignInLink}
        disabled={busyAction !== null}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/50 px-4 py-3.5 text-sm font-semibold text-slate-300 transition hover:border-blue-500/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busyAction === "link" ? (
          <Loader2 size={17} className="animate-spin" />
        ) : (
          <KeyRound size={17} />
        )}
        Email me a secure sign-in link
      </button>
    </div>
  );
}
