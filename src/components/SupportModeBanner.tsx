"use client";

import { useEffect, useState } from "react";

type SupportAccess = {
  departmentId: string;
  departmentName: string;
  isSupportMode?: boolean;
};

export default function SupportModeBanner() {
  const [access, setAccess] = useState<SupportAccess | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadAccess() {
      try {
        const response = await fetch("/api/access", {
          cache: "no-store",
        });

        if (!response.ok) return;

        const payload = await response.json();

        if (
          !cancelled &&
          payload.access?.isSupportMode === true
        ) {
          setAccess(payload.access);
        }
      } catch {
        // No banner outside an active support session.
      }
    }

    void loadAccess();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!access) return null;

  async function exitSupportMode() {
    const departmentId = access?.departmentId;

    if (!departmentId) return;

    setExiting(true);

    try {
      await fetch("/api/platform/support-mode", {
        method: "DELETE",
      });
    } finally {
      window.location.href = `/platform/${departmentId}`;
    }
  }

  return (
    <div className="sticky top-0 z-[100] flex items-center justify-center gap-4 border-b border-amber-400/40 bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950">
      <span>
        Support Mode - {access.departmentName}
      </span>

      <button
        type="button"
        onClick={exitSupportMode}
        disabled={exiting}
        className="rounded-md bg-slate-950 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
      >
        {exiting ? "Exiting..." : "Exit Agency"}
      </button>
    </div>
  );
}
