"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const WARNING_AFTER_MS = 25 * 60 * 1000;
const SIGN_OUT_AFTER_MS = 30 * 60 * 1000;

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
];

export default function IdleSessionGuard() {
  const [showWarning, setShowWarning] = useState(false);
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signOutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (warningTimer.current) {
      clearTimeout(warningTimer.current);
    }

    if (signOutTimer.current) {
      clearTimeout(signOutTimer.current);
    }
  }, []);

  const signOut = useCallback(() => {
    window.location.assign("/auth/signout");
  }, []);

  const resetTimers = useCallback(() => {
    clearTimers();
    setShowWarning(false);

    warningTimer.current = setTimeout(() => {
      setShowWarning(true);
    }, WARNING_AFTER_MS);

    signOutTimer.current = setTimeout(() => {
      signOut();
    }, SIGN_OUT_AFTER_MS);
  }, [clearTimers, signOut]);

  useEffect(() => {
    resetTimers();

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, resetTimers, { passive: true });
    }

    return () => {
      clearTimers();

      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, resetTimers);
      }
    };
  }, [clearTimers, resetTimers]);

  if (!showWarning) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-session-title"
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-950 p-6 shadow-2xl"
      >
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-400">
          Session Timeout
        </div>

        <h2
          id="idle-session-title"
          className="mt-2 text-xl font-bold text-white"
        >
          You will be signed out soon
        </h2>

        <p className="mt-3 text-sm leading-6 text-slate-300">
          TracePoint has been inactive for 25 minutes. For security, your
          session will automatically end after 30 minutes of inactivity.
        </p>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={resetTimers}
            className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            Stay Signed In
          </button>

          <button
            type="button"
            onClick={signOut}
            className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-red-500/50 hover:text-red-300"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}