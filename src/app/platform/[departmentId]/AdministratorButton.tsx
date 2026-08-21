"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  departmentId: string;
  userId: string;
};

export default function AdministratorButton({
  departmentId,
  userId,
}: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function makeAdministrator() {
    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        "/api/platform/agency-user-administrator",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ departmentId, userId }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || "Administrator assignment failed.",
        );
      }

      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Administrator assignment failed.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={makeAdministrator}
        disabled={saving}
        className="rounded-lg border border-emerald-700 bg-emerald-950/40 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-900/50 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Make Administrator"}
      </button>

      {error && (
        <div className="mt-1 text-xs text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}