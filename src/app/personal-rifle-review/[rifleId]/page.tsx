"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  XCircle,
  FilePenLine,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";

type Rifle = {
  id: string;
  owner_name: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  caliber: string;
  barrel_length?: string | null;
  sights_optic?: string | null;
  weapon_mounted_light?: string | null;
  sling?: string | null;
  status: string;
};

type Payload = {
  rifles: Rifle[];
  rules: {
    require_personal_rifle_qualification: boolean;
  };
  access: {
    canArmorerReview: boolean;
    canChiefReview: boolean;
  };
};

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? "The review request failed.";
  } catch {
    return "The review request failed.";
  }
}

export default function PersonalRifleReviewPage() {
  const params = useParams<{ rifleId: string }>();
  const router = useRouter();
  const rifleId = params.rifleId;

  const [rifle, setRifle] = useState<Rifle | null>(null);
  const [rules, setRules] = useState<Payload["rules"] | null>(null);
  const [access, setAccess] = useState<Payload["access"] | null>(null);
  const [inspectionDate, setInspectionDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [qualificationVerified, setQualificationVerified] = useState(false);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/armory/personal-rifles", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(await readError(response));
        const payload = (await response.json()) as Payload;
        setRifle(payload.rifles.find((item) => item.id === rifleId) ?? null);
        setRules(payload.rules);
        setAccess(payload.access);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "The rifle could not be loaded.",
        );
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [rifleId]);

  async function act(action: string) {
    const requiresNotes = [
      "request_correction",
      "armorer_deny",
      "chief_deny",
    ].includes(action);

    if (requiresNotes && !notes.trim()) {
      setError("Enter a reason before completing this action.");
      return;
    }

    if (
      action === "armorer_approve" &&
      rules?.require_personal_rifle_qualification &&
      !qualificationVerified
    ) {
      setError("Qualification must be verified before approval.");
      return;
    }

    setSaving(action);
    setError(null);

    try {
      const response = await fetch(
        `/api/armory/personal-rifles/${rifleId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            notes: notes.trim() || null,
            inspectionDate,
            qualificationVerified,
          }),
        },
      );

      if (!response.ok) throw new Error(await readError(response));
      router.push("/");
      router.refresh();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "The review action failed.",
      );
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <TracePointShell activePage="My Home">
        <div className="flex min-h-96 items-center justify-center">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading rifle review...
        </div>
      </TracePointShell>
    );
  }

  const armorerMode =
    access?.canArmorerReview && rifle?.status === "Pending Armorer Review";
  const chiefMode =
    access?.canChiefReview && rifle?.status === "Pending Chief Approval";

  return (
    <TracePointShell activePage="My Home">
      <div className="mx-auto w-full max-w-[1100px] space-y-6 p-4 sm:p-6 lg:p-8">
        <section className="rounded-[2rem] border border-slate-800 bg-slate-900 p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-400">
            My Home / Personal Rifle Review
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white">
            {armorerMode ? "Armorer Review" : "Chief Approval"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Review the submitted rifle and record the appropriate decision.
          </p>
        </section>

        {error ? (
          <section className="flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            {error}
          </section>
        ) : null}

        {!rifle || (!armorerMode && !chiefMode) ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-500">
            This item is no longer awaiting action from your role.
          </section>
        ) : (
          <>
            <section className="rounded-[2rem] border border-slate-800 bg-slate-900 p-6">
              <h2 className="text-2xl font-bold text-white">
                {rifle.manufacturer} {rifle.model}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {rifle.owner_name} · Serial {rifle.serial_number}
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Caliber", rifle.caliber],
                  ["Barrel", rifle.barrel_length],
                  ["Optic", rifle.sights_optic],
                  ["Weapon Light", rifle.weapon_mounted_light],
                  ["Sling", rifle.sling],
                  ["Status", rifle.status],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                      {label}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-200">
                      {value || "Not recorded"}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[2rem] border border-slate-800 bg-slate-900 p-6">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-blue-400" />
                <h2 className="text-lg font-bold text-white">
                  {armorerMode ? "Inspection Decision" : "Final Decision"}
                </h2>
              </div>

              {armorerMode ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm text-slate-300">
                    Inspection date
                    <input
                      type="date"
                      value={inspectionDate}
                      onChange={(event) =>
                        setInspectionDate(event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
                    />
                  </label>

                  <label className="flex items-center gap-3 rounded-xl border border-slate-800 p-3 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={qualificationVerified}
                      onChange={(event) =>
                        setQualificationVerified(event.target.checked)
                      }
                    />
                    Qualification verified
                  </label>
                </div>
              ) : null}

              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                placeholder="Decision notes or required reason"
                className="mt-4 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500"
              />

              <div className="mt-4 flex flex-wrap gap-2">
                {armorerMode ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void act("armorer_approve")}
                      disabled={Boolean(saving)}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Approve and Escalate
                    </button>
                    <button
                      type="button"
                      onClick={() => void act("request_correction")}
                      disabled={Boolean(saving)}
                      className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                      <FilePenLine className="h-4 w-4" />
                      Return for Correction
                    </button>
                    <button
                      type="button"
                      onClick={() => void act("armorer_deny")}
                      disabled={Boolean(saving)}
                      className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4" />
                      Deny
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void act("chief_approve")}
                      disabled={Boolean(saving)}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Final Approval
                    </button>
                    <button
                      type="button"
                      onClick={() => void act("chief_deny")}
                      disabled={Boolean(saving)}
                      className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4" />
                      Deny
                    </button>
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </TracePointShell>
  );
}
