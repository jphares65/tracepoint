"use client";

import { useState } from "react";

export default function AccessAgencyButton({
  departmentId,
}: {
  departmentId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function accessAgency() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/platform/support-mode", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ departmentId }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          payload.error ?? "Agency access could not be started.",
        );
      }

      window.location.href = "/firearms";
    } catch (accessError) {
      setError(
        accessError instanceof Error
          ? accessError.message
          : "Agency access could not be started.",
      );
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={accessAgency}
        disabled={loading}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {loading ? "Opening Agency..." : "Access Agency"}
      </button>

      {error ? (
        <p className="mt-2 text-sm text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
