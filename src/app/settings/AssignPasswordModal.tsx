"use client";

import { useState, type FormEvent } from "react";
import {
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  X,
} from "lucide-react";

type AssignPasswordModalProps = {
  departmentId: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};

export default function AssignPasswordModal({
  departmentId,
  userId,
  userName,
  userEmail,
  onClose,
  onSuccess,
  onError,
}: AssignPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    if (password.length < 8) {
      setLocalError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setLocalError("Passwords do not match.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(
        "/api/settings/users/assign-password",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            departmentId,
            userId,
            password,
          }),
        },
      );

      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          result.error || "The password could not be assigned.",
        );
      }

      onSuccess(
        result.message ||
          `A new password was assigned to ${userName}.`,
      );
      onClose();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The password could not be assigned.";

      setLocalError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="Close assign-password dialog"
        onClick={onClose}
        disabled={saving}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <section className="relative z-10 w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50">
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-amber-500/25 bg-amber-500/10 text-amber-300">
              <KeyRound size={19} />
            </span>

            <div>
              <h2 className="text-lg font-semibold text-white">
                Assign New Password
              </h2>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                Set a new login password for {userName}.
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-800 p-2 text-slate-500 transition hover:text-white disabled:opacity-50"
          >
            <X size={17} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5 p-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3">
            <p className="text-sm font-semibold text-slate-200">
              {userName}
            </p>

            <p className="mt-1 text-xs text-slate-600">
              {userEmail || "No email address recorded"}
            </p>
          </div>

          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-200">
            This immediately replaces the user&apos;s current password.
            Provide the new password to the user through an appropriate
            secure method.
          </div>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-slate-300">
              New password
            </span>

            <div className="flex items-center rounded-2xl border border-slate-700 bg-slate-950/70 pr-3 transition focus-within:border-blue-500/70">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="min-w-0 flex-1 bg-transparent px-3.5 py-3 text-sm text-white outline-none"
              />

              <button
                type="button"
                aria-label={
                  showPassword ? "Hide password" : "Show password"
                }
                onClick={() => setShowPassword((current) => !current)}
                className="text-slate-500 transition hover:text-white"
              >
                {showPassword ? (
                  <EyeOff size={17} />
                ) : (
                  <Eye size={17} />
                )}
              </button>
            </div>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-slate-300">
              Confirm new password
            </span>

            <input
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(event) =>
                setConfirmPassword(event.target.value)
              }
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3.5 py-3 text-sm text-white outline-none transition focus:border-blue-500/70"
            />
          </label>

          {localError ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {localError}
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-2xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <ShieldCheck size={16} />
              )}

              {saving ? "Assigning..." : "Assign Password"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

