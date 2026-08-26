"use client";

import { Clock3, LoaderCircle, Mail, Save, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type DigestMode = "Immediate" | "Daily" | "Weekly";

type NotificationPreferences = {
  in_app_enabled: boolean;
  email_enabled: boolean;
  critical_email_only: boolean;
  digest_mode: DigestMode;
  source_preferences: Record<string, boolean>;
};

const DEFAULT_PREFERENCES: NotificationPreferences = {
  in_app_enabled: true,
  email_enabled: true,
  critical_email_only: true,
  digest_mode: "Daily",
  source_preferences: {},
};

function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-200">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          {description}
        </p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-blue-600" : "bg-slate-700"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}

export default function NotificationPreferencesPanel() {
  const [preferences, setPreferences] =
    useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/notifications/preferences", {
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => ({}))) as {
        preferences?: NotificationPreferences;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error || "Notification preferences could not be loaded.",
        );
      }

      setPreferences({
        ...DEFAULT_PREFERENCES,
        ...(payload.preferences ?? {}),
        in_app_enabled: true,
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Notification preferences could not be loaded.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  async function savePreferences() {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...preferences,
          in_app_enabled: true,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        preferences?: NotificationPreferences;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error || "Notification preferences could not be saved.",
        );
      }

      if (payload.preferences) {
        setPreferences({
          ...DEFAULT_PREFERENCES,
          ...payload.preferences,
          in_app_enabled: true,
        });
      }

      setMessage({
        tone: "success",
        text: "Email notification preferences saved.",
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Notification preferences could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/60">
        <div className="text-center">
          <LoaderCircle
            size={26}
            className="mx-auto animate-spin text-blue-400"
          />
          <p className="mt-3 text-sm text-slate-500">
            Loading notification preferences...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-300">
                <Mail size={20} />
              </span>
              <div>
                <h2 className="text-base font-semibold text-white">
                  My Email Notifications
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Choose how TracePoint emails items from your personal Inbox.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void savePreferences()}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <LoaderCircle size={15} className="animate-spin" />
            ) : (
              <Save size={15} />
            )}
            {saving ? "Saving..." : "Save Preferences"}
          </button>
        </div>

        {message ? (
          <div
            className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${
              message.tone === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/30 bg-rose-500/10 text-rose-200"
            }`}
          >
            {message.text}
          </div>
        ) : null}

        <div className="mt-5 space-y-3">
          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 px-4 py-4">
            <div className="flex items-start gap-3">
              <ShieldCheck
                size={18}
                className="mt-0.5 shrink-0 text-blue-300"
              />
              <div>
                <p className="text-sm font-medium text-blue-100">
                  Your TracePoint Inbox stays active
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Email is a supplemental reminder. The in-app Inbox remains
                  the authoritative location for readiness and action items.
                </p>
              </div>
            </div>
          </div>

          <ToggleRow
            title="Email Inbox reminders"
            description="Send grouped email reminders for eligible open items in your TracePoint Inbox."
            checked={preferences.email_enabled}
            onChange={(checked) =>
              setPreferences((current) => ({
                ...current,
                email_enabled: checked,
              }))
            }
          />

          <ToggleRow
            title="Critical items only"
            description="When enabled, routine and warning items remain in TracePoint without generating email."
            checked={preferences.critical_email_only}
            disabled={!preferences.email_enabled}
            onChange={(checked) =>
              setPreferences((current) => ({
                ...current,
                critical_email_only: checked,
              }))
            }
          />
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Clock3 size={19} className="mt-0.5 shrink-0 text-blue-300" />
          <div>
            <h2 className="text-sm font-semibold text-white">
              Delivery Schedule
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Multiple due items are grouped into one Inbox summary whenever
              possible to prevent repetitive email.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {(
            [
              {
                value: "Immediate",
                title: "Immediate",
                detail: "Usually within 15 minutes.",
              },
              {
                value: "Daily",
                title: "Daily summary",
                detail: "One grouped summary around 9:00 AM Eastern.",
              },
              {
                value: "Weekly",
                title: "Weekly summary",
                detail: "One grouped summary Monday around 9:00 AM Eastern.",
              },
            ] as Array<{
              value: DigestMode;
              title: string;
              detail: string;
            }>
          ).map((option) => {
            const selected = preferences.digest_mode === option.value;

            return (
              <button
                key={option.value}
                type="button"
                disabled={!preferences.email_enabled}
                onClick={() =>
                  setPreferences((current) => ({
                    ...current,
                    digest_mode: option.value,
                  }))
                }
                className={`rounded-2xl border px-4 py-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  selected
                    ? "border-blue-500/60 bg-blue-500/10"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                }`}
              >
                <p
                  className={`text-sm font-semibold ${
                    selected ? "text-blue-200" : "text-slate-200"
                  }`}
                >
                  {option.title}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  {option.detail}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-amber-500/20 bg-amber-500/5 px-4 py-4 sm:px-5">
        <p className="text-sm font-semibold text-amber-100">
          New-agency qualification safeguard
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Qualification-related email begins only after the department records
          qualification activity through Range Days. This prevents a newly
          onboarded agency from receiving repeated “no qualification record”
          email while its historical data is still being loaded.
        </p>
      </section>
    </div>
  );
}
