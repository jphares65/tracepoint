"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  departmentId: string;
  userId: string;
  activationStatus: string | null;
};

export default function ActivationButton({
  departmentId,
  userId,
  activationStatus,
}: Props) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const canSend =
    activationStatus === "pending_activation" ||
    activationStatus === "activation_sent";

  if (!canSend) {
    return <span className="text-emerald-400">Activated</span>;
  }

  async function sendActivation() {
    setSending(true);
    setError("");

    try {
      const response = await fetch("/api/settings/users/activation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId, userId }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Activation failed.");
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Activation failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={sendActivation}
        disabled={sending}
        className="rounded-lg border border-blue-700 bg-blue-950/40 px-3 py-2 text-xs font-medium text-blue-300 hover:bg-blue-900/50 disabled:opacity-50"
      >
        {sending
          ? "Sending..."
          : activationStatus === "activation_sent"
            ? "Resend Activation"
            : "Send Activation"}
      </button>

      {error && (
        <div className="mt-1 text-xs text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}