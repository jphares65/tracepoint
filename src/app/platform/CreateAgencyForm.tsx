"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateAgencyForm() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [slug, setSlug] = useState("");
  const [state, setState] = useState("NJ");
  const [county, setCounty] = useState("");
  const [agencyType, setAgencyType] = useState(
    "Municipal Police Department"
  );
  const [timezone, setTimezone] = useState("America/New_York");
  const [swornOfficers, setSwornOfficers] = useState("0");
  const [civilianStaff, setCivilianStaff] = useState("0");
  const [accountStatus, setAccountStatus] = useState("pilot");
  const [planType, setPlanType] = useState("pilot");
  const [internalNotes, setInternalNotes] = useState("");

  function generateSlug(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/platform/agencies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          shortName,
          slug,
          state,
          county,
          agencyType,
          timezone,
          swornOfficers: Number(swornOfficers || 0),
          civilianStaff: Number(civilianStaff || 0),
          accountStatus,
          planType,
          internalNotes,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to create agency.");
      }

      setOpen(false);

      setName("");
      setShortName("");
      setSlug("");
      setCounty("");
      setSwornOfficers("0");
      setCivilianStaff("0");
      setInternalNotes("");

      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to create agency."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
      >
        + Create Agency
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Create Agency
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Provision a new TracePoint tenant.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-slate-400 hover:text-white"
        >
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Agency name">
            <input
              required
              value={name}
              onChange={(event) => {
                const value = event.target.value;
                setName(value);

                if (!slug || slug === generateSlug(name)) {
                  setSlug(generateSlug(value));
                }
              }}
              className={inputClass}
              placeholder="Montville Township Police Department"
            />
          </Field>

          <Field label="Short name">
            <input
              value={shortName}
              onChange={(event) => setShortName(event.target.value)}
              className={inputClass}
              placeholder="Montville PD"
            />
          </Field>

          <Field label="Agency slug">
            <input
              required
              value={slug}
              onChange={(event) =>
                setSlug(generateSlug(event.target.value))
              }
              className={inputClass}
              placeholder="montville-pd"
            />
          </Field>

          <Field label="Agency type">
            <select
              value={agencyType}
              onChange={(event) => setAgencyType(event.target.value)}
              className={inputClass}
            >
              <option>Municipal Police Department</option>
              <option>County Prosecutor's Office</option>
              <option>County Sheriff's Office</option>
              <option>State Law Enforcement Agency</option>
              <option>Other</option>
            </select>
          </Field>

          <Field label="State">
            <input
              value={state}
              onChange={(event) => setState(event.target.value)}
              className={inputClass}
              placeholder="NJ"
            />
          </Field>

          <Field label="County">
            <input
              value={county}
              onChange={(event) => setCounty(event.target.value)}
              className={inputClass}
              placeholder="Morris"
            />
          </Field>

          <Field label="Time zone">
            <select
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              className={inputClass}
            >
              <option value="America/New_York">Eastern</option>
              <option value="America/Chicago">Central</option>
              <option value="America/Denver">Mountain</option>
              <option value="America/Los_Angeles">Pacific</option>
            </select>
          </Field>

          <Field label="Account status">
            <select
              value={accountStatus}
              onChange={(event) => setAccountStatus(event.target.value)}
              className={inputClass}
            >
              <option value="pilot">Pilot</option>
              <option value="onboarding">Onboarding</option>
              <option value="active">Active</option>
            </select>
          </Field>

          <Field label="Plan">
            <select
              value={planType}
              onChange={(event) => setPlanType(event.target.value)}
              className={inputClass}
            >
              <option value="pilot">Pilot</option>
              <option value="paid">Paid</option>
              <option value="lifetime_free">Lifetime Free</option>
              <option value="internal">Internal</option>
            </select>
          </Field>

          <Field label="Sworn officers">
            <input
              type="number"
              min="0"
              value={swornOfficers}
              onChange={(event) => setSwornOfficers(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Civilian staff">
            <input
              type="number"
              min="0"
              value={civilianStaff}
              onChange={(event) => setCivilianStaff(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Internal notes">
          <textarea
            value={internalNotes}
            onChange={(event) => setInternalNotes(event.target.value)}
            className={`${inputClass} min-h-24`}
            placeholder="Initial pilot agency."
          />
        </Field>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            disabled={submitting}
            onClick={() => setOpen(false)}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create Agency"}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-blue-500";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-300">
        {label}
      </span>
      {children}
    </label>
  );
}
