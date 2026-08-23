"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  RotateCcw,
  Save,
  ShieldCheck,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type RangeQualificationRules = {
  schema_version: number;

  require_day_handgun_qualification: boolean;
  require_night_handgun_qualification: boolean;

  require_rifle_qualification: boolean;
  require_rifle_familiarization: boolean;

  rifle_familiarization_valid_days: number;
  rifle_familiarization_due_soon_days: number;
  rifle_familiarization_affects_readiness: boolean;

  qualification_failure_requires_remediation: boolean;
  remediation_due_days: number;

  missing_required_qualification_affects_readiness: boolean;
  expired_qualification_affects_readiness: boolean;

  firearm_failure_lockout_enabled: boolean;
  firearm_failure_lockout_threshold: number;
  firearm_failure_count_mode: "consecutive_since_pass";
  firearm_failure_scope: "specific_firearm";
  passing_requalification_restores_authorization: boolean;
  require_supervisor_release_after_requalification: boolean;
};

const DEFAULT_RULES: RangeQualificationRules = {
  schema_version: 1,

  require_day_handgun_qualification: true,
  require_night_handgun_qualification: true,

  require_rifle_qualification: false,
  require_rifle_familiarization: false,

  rifle_familiarization_valid_days: 365,
  rifle_familiarization_due_soon_days: 30,
  rifle_familiarization_affects_readiness: true,

  qualification_failure_requires_remediation: true,
  remediation_due_days: 30,

  missing_required_qualification_affects_readiness: true,
  expired_qualification_affects_readiness: true,

  firearm_failure_lockout_enabled: true,
  firearm_failure_lockout_threshold: 2,
  firearm_failure_count_mode: "consecutive_since_pass",
  firearm_failure_scope: "specific_firearm",
  passing_requalification_restores_authorization: true,
  require_supervisor_release_after_requalification: false,
};

function normalizeRules(
  input: Partial<RangeQualificationRules> | null | undefined,
  legacyFamiliarization: boolean,
): RangeQualificationRules {
  return {
    ...DEFAULT_RULES,
    ...(input ?? {}),
    schema_version: 1,
    require_rifle_familiarization:
      typeof input?.require_rifle_familiarization === "boolean"
        ? input.require_rifle_familiarization
        : legacyFamiliarization,
  };
}

function Toggle({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div>
        <p className="text-sm font-semibold text-slate-200">{title}</p>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
          {description}
        </p>
      </div>

      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0"
      />
    </label>
  );
}

function DaysInput({
  label,
  description,
  value,
  min = 0,
  max = 3650,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <span className="text-sm font-semibold text-slate-200">{label}</span>

      <span className="mt-1 block text-xs leading-5 text-slate-500">
        {description}
      </span>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const parsed = Number(event.target.value);

            if (!Number.isFinite(parsed)) return;

            onChange(Math.max(min, Math.min(max, parsed)));
          }}
          className="w-28 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500 disabled:opacity-50"
        />

        <span className="text-xs text-slate-500">days</span>
      </div>
    </label>
  );
}

export default function RangeQualificationRulesPanel({
  departmentId,
  canAdminister,
}: {
  departmentId: string;
  canAdminister: boolean;
}) {
  const supabase = createClient();

  const [rules, setRules] =
    useState<RangeQualificationRules>(DEFAULT_RULES);

  const [originalRules, setOriginalRules] =
    useState<RangeQualificationRules>(DEFAULT_RULES);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  async function loadRules() {
    if (!departmentId) return;

    setLoading(true);
    setNotice(null);

    try {
      const { data, error } = await (supabase as any)
        .from("department_rules")
        .select(
          "require_rifle_familiarization,range_qualification_rules",
        )
        .eq("department_id", departmentId)
        .maybeSingle();

      if (error) throw error;

      const normalized = normalizeRules(
        data?.range_qualification_rules,
        Boolean(data?.require_rifle_familiarization),
      );

      setRules(normalized);
      setOriginalRules(normalized);
    } catch (error) {
      console.error(error);

      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Range and Qualification rules could not be loaded.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId]);

  function patchRule<K extends keyof RangeQualificationRules>(
    key: K,
    value: RangeQualificationRules[K],
  ) {
    setRules((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function saveRules() {
    if (!departmentId || !canAdminister) return;

    setSaving(true);
    setNotice(null);

    try {
      const normalized: RangeQualificationRules = {
        ...rules,
        schema_version: 1,

        rifle_familiarization_valid_days: Math.max(
          1,
          rules.rifle_familiarization_valid_days,
        ),

        rifle_familiarization_due_soon_days: Math.min(
          Math.max(0, rules.rifle_familiarization_due_soon_days),
          Math.max(0, rules.rifle_familiarization_valid_days - 1),
        ),

        remediation_due_days: Math.max(
          1,
          rules.remediation_due_days,
        ),

        firearm_failure_lockout_threshold: Math.max(
          1,
          rules.firearm_failure_lockout_threshold,
        ),

        firearm_failure_count_mode: "consecutive_since_pass",
        firearm_failure_scope: "specific_firearm",
      };

      const { error } = await (supabase as any)
        .from("department_rules")
        .upsert(
          {
            department_id: departmentId,

            // Keep legacy field synchronized while consumers migrate.
            require_rifle_familiarization:
              normalized.require_rifle_familiarization,

            range_qualification_rules: normalized,
          },
          {
            onConflict: "department_id",
          },
        );

      if (error) throw error;

      setRules(normalized);
      setOriginalRules(normalized);

      setNotice({
        tone: "success",
        message: "Range and Qualification rules saved.",
      });
    } catch (error) {
      console.error(error);

      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Range and Qualification rules could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    JSON.stringify(rules) !== JSON.stringify(originalRules);

  if (loading) {
    return (
      <div className="xl:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-8">
        <div className="flex items-center justify-center gap-3 text-sm text-slate-400">
          <LoaderCircle size={18} className="animate-spin text-blue-400" />
          Loading Range and Qualification policy...
        </div>
      </div>
    );
  }

  return (
    <section className="xl:col-span-2 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">

      <div className="border-b border-slate-800 px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-400">
              Operational Policy
            </p>

            <h3 className="mt-1 text-base font-bold text-white">
              Range & Qualification Readiness
            </h3>

            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
              Define which firearm training requirements apply to this
              department and how missing, expired, or failed requirements
              affect readiness.
            </p>
          </div>

          {canAdminister ? (
            <div className="flex gap-2">

              <button
                type="button"
                disabled={!dirty || saving}
                onClick={() => {
                  setRules(originalRules);
                  setNotice(null);
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-600 disabled:opacity-40"
              >
                <RotateCcw size={14} />
                Reset
              </button>

              <button
                type="button"
                disabled={!dirty || saving}
                onClick={() => void saveRules()}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:opacity-40"
              >
                {saving ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}

                {saving ? "Saving..." : "Save Range Rules"}
              </button>

            </div>
          ) : null}

        </div>
      </div>

      {notice ? (
        <div
          className={`mx-5 mt-4 flex items-start gap-2 rounded-xl border p-3 text-xs ${
            notice.tone === "success"
              ? "border-emerald-800 bg-emerald-950/30 text-emerald-200"
              : "border-red-800 bg-red-950/30 text-red-200"
          }`}
        >
          {notice.tone === "success" ? (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          )}

          {notice.message}
        </div>
      ) : null}

      <div className="grid gap-5 p-5 lg:grid-cols-2">

        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-bold text-white">
              Handgun Qualification
            </h4>

            <p className="mt-1 text-xs leading-5 text-slate-500">
              Configure which handgun qualification components TracePoint
              treats as required for readiness.
            </p>
          </div>

          <Toggle
            title="Require day handgun qualification"
            description="A current day handgun qualification is required for personnel readiness."
            checked={rules.require_day_handgun_qualification}
            disabled={!canAdminister}
            onChange={(value) =>
              patchRule("require_day_handgun_qualification", value)
            }
          />

          <Toggle
            title="Require night handgun qualification"
            description="A current night handgun qualification is independently required for personnel readiness."
            checked={rules.require_night_handgun_qualification}
            disabled={!canAdminister}
            onChange={(value) =>
              patchRule("require_night_handgun_qualification", value)
            }
          />

          <Toggle
            title="Missing required qualification affects readiness"
            description="Personnel with a missing required qualification should be treated as not ready."
            checked={
              rules.missing_required_qualification_affects_readiness
            }
            disabled={!canAdminister}
            onChange={(value) =>
              patchRule(
                "missing_required_qualification_affects_readiness",
                value,
              )
            }
          />

          <Toggle
            title="Expired qualification affects readiness"
            description="Expired required qualification records should place personnel into a readiness exception state."
            checked={rules.expired_qualification_affects_readiness}
            disabled={!canAdminister}
            onChange={(value) =>
              patchRule(
                "expired_qualification_affects_readiness",
                value,
              )
            }
          />
        </div>


        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-bold text-white">
              Rifle Requirements
            </h4>

            <p className="mt-1 text-xs leading-5 text-slate-500">
              Rifle qualification and rifle familiarization are separate
              requirements and may be enabled independently.
            </p>
          </div>

          <Toggle
            title="Require rifle qualification"
            description="Personnel subject to the rifle program must maintain a current rifle qualification."
            checked={rules.require_rifle_qualification}
            disabled={!canAdminister}
            onChange={(value) =>
              patchRule("require_rifle_qualification", value)
            }
          />

          <Toggle
            title="Require rifle familiarization"
            description="Track rifle familiarization as a distinct agency requirement. This supports the separate familiarization requirement used by New Jersey agencies."
            checked={rules.require_rifle_familiarization}
            disabled={!canAdminister}
            onChange={(value) =>
              patchRule("require_rifle_familiarization", value)
            }
          />

          {rules.require_rifle_familiarization ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <DaysInput
                  label="Familiarization validity"
                  description="How long a completed rifle familiarization remains current."
                  value={rules.rifle_familiarization_valid_days}
                  min={1}
                  disabled={!canAdminister}
                  onChange={(value) => {
                    patchRule(
                      "rifle_familiarization_valid_days",
                      value,
                    );

                    if (
                      rules.rifle_familiarization_due_soon_days >= value
                    ) {
                      patchRule(
                        "rifle_familiarization_due_soon_days",
                        Math.max(0, value - 1),
                      );
                    }
                  }}
                />

                <DaysInput
                  label="Familiarization warning"
                  description="How many days before expiration TracePoint should flag the requirement."
                  value={rules.rifle_familiarization_due_soon_days}
                  min={0}
                  max={Math.max(
                    0,
                    rules.rifle_familiarization_valid_days - 1,
                  )}
                  disabled={!canAdminister}
                  onChange={(value) =>
                    patchRule(
                      "rifle_familiarization_due_soon_days",
                      value,
                    )
                  }
                />
              </div>

              <Toggle
                title="Familiarization affects readiness"
                description="Missing or expired rifle familiarization creates a readiness exception when familiarization is required."
                checked={
                  rules.rifle_familiarization_affects_readiness
                }
                disabled={!canAdminister}
                onChange={(value) =>
                  patchRule(
                    "rifle_familiarization_affects_readiness",
                    value,
                  )
                }
              />
            </>
          ) : null}
        </div>


        <div className="space-y-3 lg:col-span-2">
          <div className="flex items-start gap-3 rounded-xl border border-amber-800/60 bg-amber-950/20 p-4">
            <ShieldCheck
              size={18}
              className="mt-0.5 shrink-0 text-amber-300"
            />

            <div>
              <h4 className="text-sm font-bold text-amber-100">
                Failure & Remediation
              </h4>

              <p className="mt-1 text-xs leading-5 text-amber-100/60">
                Configure what TracePoint should expect after an officer fails
                a qualification requirement.
              </p>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">

            <Toggle
              title="Suspend firearm authorization after repeated failures"
              description="When an officer reaches the configured consecutive-failure threshold with a specific firearm, that officer/firearm relationship becomes Qualification Restricted. The firearm itself remains Active unless a separate armory condition changes its status."
              checked={rules.firearm_failure_lockout_enabled}
              disabled={!canAdminister}
              onChange={(value) =>
                patchRule(
                  "firearm_failure_lockout_enabled",
                  value,
                )
              }
            />

            {rules.firearm_failure_lockout_enabled ? (
              <DaysInput
                label="Failed qualification threshold"
                description="Number of consecutive recorded failures with the same firearm before that officer's authorization for the firearm becomes restricted."
                value={rules.firearm_failure_lockout_threshold}
                min={1}
                max={20}
                disabled={!canAdminister}
                onChange={(value) =>
                  patchRule(
                    "firearm_failure_lockout_threshold",
                    value,
                  )
                }
              />
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4 text-xs leading-5 text-slate-500">
                Repeated qualification failures will not automatically
                restrict an officer's authorization for the associated
                firearm.
              </div>
            )}

            {rules.firearm_failure_lockout_enabled ? (
              <>
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <p className="text-sm font-semibold text-slate-200">
                    Failure counting
                  </p>

                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    TracePoint counts consecutive failures with the specific
                    firearm used. A later passing qualification resets the
                    consecutive-failure count. Historical failures before a
                    successful qualification do not accumulate forever.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <p className="text-sm font-semibold text-slate-200">
                    Restriction scope
                  </p>

                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    The restriction applies only to the officer and the
                    firearm used in the failed qualification attempts. It does
                    not place the firearm itself Out of Service.
                  </p>
                </div>

                <Toggle
                  title="Passing requalification restores authorization"
                  description="A later passing qualification with the same firearm can clear the qualification restriction."
                  checked={
                    rules.passing_requalification_restores_authorization
                  }
                  disabled={!canAdminister}
                  onChange={(value) =>
                    patchRule(
                      "passing_requalification_restores_authorization",
                      value,
                    )
                  }
                />

                {rules.passing_requalification_restores_authorization ? (
                  <Toggle
                    title="Require supervisor / range-master release after passing"
                    description="Keep the officer/firearm relationship restricted after a successful requalification until an authorized supervisor or range-master formally releases the restriction."
                    checked={
                      rules.require_supervisor_release_after_requalification
                    }
                    disabled={!canAdminister}
                    onChange={(value) =>
                      patchRule(
                        "require_supervisor_release_after_requalification",
                        value,
                      )
                    }
                  />
                ) : (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4 text-xs leading-5 text-slate-500">
                    A passing qualification alone will not automatically
                    restore firearm authorization under current agency policy.
                  </div>
                )}
              </>
            ) : null}

            <Toggle
              title="Failed qualification requires remediation"
              description="A failed qualification creates a remediation requirement rather than being treated only as historical documentation."
              checked={
                rules.qualification_failure_requires_remediation
              }
              disabled={!canAdminister}
              onChange={(value) =>
                patchRule(
                  "qualification_failure_requires_remediation",
                  value,
                )
              }
            />

            {rules.qualification_failure_requires_remediation ? (
              <DaysInput
                label="Remediation deadline"
                description="Maximum number of days permitted to complete required remediation."
                value={rules.remediation_due_days}
                min={1}
                disabled={!canAdminister}
                onChange={(value) =>
                  patchRule("remediation_due_days", value)
                }
              />
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4 text-xs leading-5 text-slate-500">
                Remediation deadlines are disabled because remediation is not
                currently required by agency policy.
              </div>
            )}

          </div>
        </div>

      </div>
    </section>
  );
}