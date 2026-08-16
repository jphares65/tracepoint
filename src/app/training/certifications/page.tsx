"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import {
  Award,
  ChevronLeft,
  Pencil,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";

type Member = {
  user_id: string;
  full_name: string;
  badge_number?: string | null;
  rank_title?: string | null;
  is_active?: boolean;
};

type Certification = {
  id: string;
  user_id: string;
  certification_type_id?: string | null;
  certification_title: string;
  issuing_organization?: string | null;
  credential_number?: string | null;
  issue_date?: string | null;
  expiration_date?: string | null;
  reminder_days?: number[] | null;
  notes?: string | null;
  document_url?: string | null;
};

type CertificationType = {
  id: string;
  name: string;
  description?: string | null;
  category: string;
  issuing_organization?: string | null;
  expiration_required: boolean;
  default_valid_days?: number | null;
  default_due_soon_days: number;
  is_active: boolean;
};

type Requirement = {
  id: string;
  certification_type_id: string;
  is_required: boolean;
  valid_days?: number | null;
  due_soon_days?: number | null;
  is_active: boolean;
  notes?: string | null;
};

type CertificationFormState = {
  userId: string;
  certificationTypeId: string;
  issuingOrganization: string;
  credentialNumber: string;
  issueDate: string;
  expirationDate: string;
  reminderDays: number[];
  documentUrl: string;
  notes: string;
};

type TypeFormState = {
  certificationTypeId: string;
  name: string;
  category: string;
  description: string;
  issuingOrganization: string;
  expirationRequired: boolean;
  defaultValidDays: string;
  defaultDueSoonDays: string;
};

type RequirementFormState = {
  certificationTypeId: string;
  isRequired: boolean;
  validDays: string;
  dueSoonDays: string;
  isActive: boolean;
  notes: string;
};

const DEFAULT_REMINDERS = [180, 90, 60, 30, 14, 7, 0];

const EMPTY_CERTIFICATION_FORM: CertificationFormState = {
  userId: "",
  certificationTypeId: "",
  issuingOrganization: "",
  credentialNumber: "",
  issueDate: "",
  expirationDate: "",
  reminderDays: [90, 60, 30, 14, 7, 0],
  documentUrl: "",
  notes: "",
};

const EMPTY_TYPE_FORM: TypeFormState = {
  certificationTypeId: "",
  name: "",
  category: "General",
  description: "",
  issuingOrganization: "",
  expirationRequired: true,
  defaultValidDays: "",
  defaultDueSoonDays: "30",
};

const EMPTY_REQUIREMENT_FORM: RequirementFormState = {
  certificationTypeId: "",
  isRequired: true,
  validDays: "",
  dueSoonDays: "",
  isActive: true,
  notes: "",
};

function parseNumberOrNull(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function daysUntil(date: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(`${date}T00:00:00`);
  return Math.ceil(
    (target.getTime() - today.getTime()) / 86400000,
  );
}

export default function CertificationsPage() {
  const [certifications, setCertifications] = useState<
    Certification[]
  >([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [certificationTypes, setCertificationTypes] =
    useState<CertificationType[]>([]);
  const [requirements, setRequirements] = useState<
    Requirement[]
  >([]);

  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [credentialModalOpen, setCredentialModalOpen] =
    useState(false);
  const [editingCredentialId, setEditingCredentialId] =
    useState<string | null>(null);
  const [credentialForm, setCredentialForm] =
    useState<CertificationFormState>(
      EMPTY_CERTIFICATION_FORM,
    );

  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [typeForm, setTypeForm] =
    useState<TypeFormState>(EMPTY_TYPE_FORM);

  const [requirementModalOpen, setRequirementModalOpen] =
    useState(false);
  const [requirementForm, setRequirementForm] =
    useState<RequirementFormState>(
      EMPTY_REQUIREMENT_FORM,
    );

  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError("");

    const response = await fetch(
      "/api/training/certifications",
      { cache: "no-store" },
    );

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(
        payload.error ||
          "Certifications could not be loaded.",
      );
    } else {
      setCertifications(payload.certifications ?? []);
      setMembers(
        (payload.members ?? []).filter(
          (member: Member) => member.is_active !== false,
        ),
      );
      setCertificationTypes(
        payload.certificationTypes ?? [],
      );
      setRequirements(payload.requirements ?? []);
      setCanManage(Boolean(payload.canManage));
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const memberMap = useMemo(
    () =>
      new Map(
        members.map((member) => [
          member.user_id,
          member,
        ]),
      ),
    [members],
  );

  const typeMap = useMemo(
    () =>
      new Map(
        certificationTypes.map((type) => [type.id, type]),
      ),
    [certificationTypes],
  );

  const requirementMap = useMemo(
    () =>
      new Map(
        requirements.map((requirement) => [
          requirement.certification_type_id,
          requirement,
        ]),
      ),
    [requirements],
  );

  function getEffectiveDueSoonDays(
    certificationTypeId?: string | null,
  ) {
    if (!certificationTypeId) return 30;

    const type = typeMap.get(certificationTypeId);
    const requirement =
      requirementMap.get(certificationTypeId);

    if (
      requirement?.due_soon_days !== null &&
      requirement?.due_soon_days !== undefined
    ) {
      return requirement.due_soon_days;
    }

    return type?.default_due_soon_days ?? 30;
  }

  function getStatus(item: Certification) {
    if (!item.expiration_date) {
      return {
        label: "No Expiration",
        className:
          "border-slate-700 bg-slate-800/60 text-slate-300",
      };
    }

    const days = daysUntil(item.expiration_date);

    if (days < 0) {
      return {
        label: "Expired",
        className:
          "border-red-500/30 bg-red-500/10 text-red-300",
      };
    }

    const warningWindow = getEffectiveDueSoonDays(
      item.certification_type_id,
    );

    if (days <= warningWindow) {
      return {
        label:
          days === 0
            ? "Expires today"
            : `Due in ${days} days`,
        className:
          "border-amber-500/30 bg-amber-500/10 text-amber-300",
      };
    }

    return {
      label: "Current",
      className:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    };
  }

  function openNewCredential() {
    setEditingCredentialId(null);
    setCredentialForm(EMPTY_CERTIFICATION_FORM);
    setCredentialModalOpen(true);
  }

  function openEditCredential(item: Certification) {
    setEditingCredentialId(item.id);

    setCredentialForm({
      userId: item.user_id,
      certificationTypeId:
        item.certification_type_id ?? "",
      issuingOrganization:
        item.issuing_organization ?? "",
      credentialNumber: item.credential_number ?? "",
      issueDate: item.issue_date ?? "",
      expirationDate: item.expiration_date ?? "",
      reminderDays:
        item.reminder_days ?? DEFAULT_REMINDERS,
      documentUrl: item.document_url ?? "",
      notes: item.notes ?? "",
    });

    setCredentialModalOpen(true);
  }

  function selectCredentialType(certificationTypeId: string) {
    const selected = typeMap.get(certificationTypeId);

    setCredentialForm((current) => ({
      ...current,
      certificationTypeId,
      issuingOrganization:
        current.issuingOrganization ||
        selected?.issuing_organization ||
        "",
    }));
  }

  async function saveCredential(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const response = await fetch(
      editingCredentialId
        ? `/api/training/certifications/${editingCredentialId}`
        : "/api/training/certifications",
      {
        method: editingCredentialId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentialForm),
      },
    );

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(
        payload.error ||
          "The certification could not be saved.",
      );
    } else {
      setCredentialModalOpen(false);
      await load();
    }

    setSaving(false);
  }

  async function archiveCredential(id: string) {
    if (
      !window.confirm(
        "Archive this certification? Its history will remain in the database.",
      )
    ) {
      return;
    }

    const response = await fetch(
      `/api/training/certifications/${id}`,
      { method: "DELETE" },
    );

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(
        payload.error ||
          "The certification could not be archived.",
      );
    } else {
      await load();
    }
  }

  function openNewType() {
    setTypeForm(EMPTY_TYPE_FORM);
    setTypeModalOpen(true);
  }

  function openEditType(type: CertificationType) {
    setTypeForm({
      certificationTypeId: type.id,
      name: type.name,
      category: type.category,
      description: type.description ?? "",
      issuingOrganization:
        type.issuing_organization ?? "",
      expirationRequired: type.expiration_required,
      defaultValidDays:
        type.default_valid_days?.toString() ?? "",
      defaultDueSoonDays:
        type.default_due_soon_days.toString(),
    });

    setTypeModalOpen(true);
  }

  async function saveType(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const editing = Boolean(
      typeForm.certificationTypeId,
    );

    const response = await fetch(
      "/api/training/certification-types",
      {
        method: editing ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...typeForm,
          defaultValidDays: parseNumberOrNull(
            typeForm.defaultValidDays,
          ),
          defaultDueSoonDays:
            parseNumberOrNull(
              typeForm.defaultDueSoonDays,
            ) ?? 30,
        }),
      },
    );

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(
        payload.error ||
          "The certification type could not be saved.",
      );
    } else {
      setTypeModalOpen(false);
      await load();
    }

    setSaving(false);
  }

  function openRequirement(
    type: CertificationType,
  ) {
    const existing = requirementMap.get(type.id);

    setRequirementForm({
      certificationTypeId: type.id,
      isRequired: existing?.is_required ?? true,
      validDays:
        existing?.valid_days?.toString() ?? "",
      dueSoonDays:
        existing?.due_soon_days?.toString() ?? "",
      isActive: existing?.is_active ?? true,
      notes: existing?.notes ?? "",
    });

    setRequirementModalOpen(true);
  }

  async function saveRequirement(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const response = await fetch(
      "/api/training/certification-requirements",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...requirementForm,
          validDays: parseNumberOrNull(
            requirementForm.validDays,
          ),
          dueSoonDays: parseNumberOrNull(
            requirementForm.dueSoonDays,
          ),
        }),
      },
    );

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(
        payload.error ||
          "The agency requirement could not be saved.",
      );
    } else {
      setRequirementModalOpen(false);
      await load();
    }

    setSaving(false);
  }

  return (
    <TracePointShell activePage="Training">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <Link
          href="/training"
          className="mb-5 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
        >
          <ChevronLeft size={16} />
          Training
        </Link>

        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-400">
              Training
            </p>

            <h1 className="mt-2 text-3xl font-bold text-white">
              Certification Readiness
            </h1>

            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Track officer credentials, expiration status,
              and agency-defined certification requirements.
            </p>
          </div>

          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={openNewType}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
              >
                <Settings2 size={16} />
                Certification Types
              </button>

              <button
                onClick={openNewCredential}
                disabled={certificationTypes.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={16} />
                Add Certification
              </button>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        {canManage ? (
          <section className="mt-7 rounded-2xl border border-slate-800 bg-slate-950/40">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div>
                <h2 className="font-semibold text-white">
                  Agency Requirements
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Requirements are configured by this agency.
                  TracePoint does not impose jurisdiction-specific
                  standards.
                </p>
              </div>
            </div>

            {certificationTypes.length === 0 ? (
              <div className="px-5 py-8 text-sm text-slate-500">
                Create a certification type to begin
                configuring readiness requirements.
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {certificationTypes.map((type) => {
                  const requirement =
                    requirementMap.get(type.id);

                  const effectiveValidity =
                    requirement?.valid_days ??
                    type.default_valid_days;

                  const effectiveWarning =
                    requirement?.due_soon_days ??
                    type.default_due_soon_days;

                  return (
                    <div
                      key={type.id}
                      className="flex flex-col justify-between gap-4 px-5 py-4 md:flex-row md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-white">
                            {type.name}
                          </span>

                          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
                            {type.category}
                          </span>

                          {requirement?.is_active &&
                          requirement.is_required ? (
                            <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-300">
                              Required
                            </span>
                          ) : (
                            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-500">
                              Optional
                            </span>
                          )}
                        </div>

                        <div className="mt-2 text-xs text-slate-500">
                          {effectiveValidity
                            ? `Valid ${effectiveValidity} days`
                            : type.expiration_required
                              ? "Expiration date required"
                              : "No fixed validity"}{" "}
                          · Warning {effectiveWarning} days
                          before expiration
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            openRequirement(type)
                          }
                          className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white"
                        >
                          Requirement
                        </button>

                        <button
                          onClick={() =>
                            openEditType(type)
                          }
                          className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white"
                          title="Edit certification type"
                        >
                          <Pencil size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}

        <section className="mt-7 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/40">
          <div className="border-b border-slate-800 px-5 py-4">
            <h2 className="font-semibold text-white">
              Officer Certifications
            </h2>
          </div>

          {loading ? (
            <div className="p-8 text-sm text-slate-500">
              Loading certifications...
            </div>
          ) : certifications.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <Award
                size={34}
                className="text-slate-700"
              />

              <h2 className="mt-4 font-semibold text-white">
                No certifications recorded
              </h2>

              <p className="mt-2 max-w-md text-sm text-slate-500">
                Add officer credentials to begin readiness
                and expiration tracking.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-4">
                      Officer
                    </th>
                    <th className="px-5 py-4">
                      Certification
                    </th>
                    <th className="px-5 py-4">
                      Requirement
                    </th>
                    <th className="px-5 py-4">
                      Issuer
                    </th>
                    <th className="px-5 py-4">
                      Expires
                    </th>
                    <th className="px-5 py-4">
                      Status
                    </th>
                    <th className="px-5 py-4 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800">
                  {certifications.map((item) => {
                    const member = memberMap.get(
                      item.user_id,
                    );

                    const type = item.certification_type_id
                      ? typeMap.get(
                          item.certification_type_id,
                        )
                      : undefined;

                    const requirement =
                      item.certification_type_id
                        ? requirementMap.get(
                            item.certification_type_id,
                          )
                        : undefined;

                    const status = getStatus(item);

                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-slate-900/40"
                      >
                        <td className="px-5 py-4">
                          <div className="font-medium text-white">
                            {member?.full_name ||
                              "Unknown officer"}
                          </div>

                          <div className="text-xs text-slate-500">
                            {[
                              member?.rank_title,
                              member?.badge_number
                                ? `#${member.badge_number}`
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="font-medium text-slate-200">
                            {type?.name ||
                              item.certification_title}
                          </div>

                          <div className="text-xs text-slate-500">
                            {item.credential_number ||
                              "No credential number"}
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          {requirement?.is_active &&
                          requirement.is_required ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-300">
                              <ShieldCheck size={14} />
                              Required
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">
                              Optional
                            </span>
                          )}
                        </td>

                        <td className="px-5 py-4 text-slate-400">
                          {item.issuing_organization ||
                            "—"}
                        </td>

                        <td className="px-5 py-4 text-slate-300">
                          {item.expiration_date ||
                            "None"}
                        </td>

                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${status.className}`}
                          >
                            {status.label}
                          </span>
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            {canManage ? (
                              <>
                                <button
                                  onClick={() =>
                                    openEditCredential(
                                      item,
                                    )
                                  }
                                  className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white"
                                  title="Edit"
                                >
                                  <Pencil size={15} />
                                </button>

                                <button
                                  onClick={() =>
                                    void archiveCredential(
                                      item.id,
                                    )
                                  }
                                  className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:border-red-500/40 hover:text-red-300"
                                  title="Archive"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {credentialModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={saveCredential}
            className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {editingCredentialId
                    ? "Edit Certification"
                    : "Add Certification"}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Record an officer-held credential.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setCredentialModalOpen(false)
                }
                className="text-slate-500 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid gap-5 p-6 md:grid-cols-2">
              <label className="text-sm text-slate-300">
                Officer
                <select
                  required
                  value={credentialForm.userId}
                  onChange={(event) =>
                    setCredentialForm({
                      ...credentialForm,
                      userId: event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                >
                  <option value="">
                    Select officer
                  </option>

                  {members.map((member) => (
                    <option
                      key={member.user_id}
                      value={member.user_id}
                    >
                      {member.full_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-slate-300">
                Certification type
                <select
                  required
                  value={
                    credentialForm.certificationTypeId
                  }
                  onChange={(event) =>
                    selectCredentialType(
                      event.target.value,
                    )
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                >
                  <option value="">
                    Select certification
                  </option>

                  {certificationTypes.map((type) => (
                    <option
                      key={type.id}
                      value={type.id}
                    >
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-slate-300">
                Issuing organization
                <input
                  value={
                    credentialForm.issuingOrganization
                  }
                  onChange={(event) =>
                    setCredentialForm({
                      ...credentialForm,
                      issuingOrganization:
                        event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                />
              </label>

              <label className="text-sm text-slate-300">
                Credential number
                <input
                  value={
                    credentialForm.credentialNumber
                  }
                  onChange={(event) =>
                    setCredentialForm({
                      ...credentialForm,
                      credentialNumber:
                        event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                />
              </label>

              <label className="text-sm text-slate-300">
                Issue date
                <input
                  type="date"
                  value={credentialForm.issueDate}
                  onChange={(event) =>
                    setCredentialForm({
                      ...credentialForm,
                      issueDate: event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                />
              </label>

              <label className="text-sm text-slate-300">
                Expiration date
                <input
                  type="date"
                  value={
                    credentialForm.expirationDate
                  }
                  onChange={(event) =>
                    setCredentialForm({
                      ...credentialForm,
                      expirationDate:
                        event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                />
              </label>

              <label className="text-sm text-slate-300 md:col-span-2">
                Document link
                <input
                  value={credentialForm.documentUrl}
                  onChange={(event) =>
                    setCredentialForm({
                      ...credentialForm,
                      documentUrl:
                        event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                  placeholder="SharePoint or secure document URL"
                />
              </label>

              <fieldset className="md:col-span-2">
                <legend className="text-sm text-slate-300">
                  Reminder schedule
                </legend>

                <div className="mt-3 flex flex-wrap gap-2">
                  {DEFAULT_REMINDERS.map((day) => {
                    const selected =
                      credentialForm.reminderDays.includes(
                        day,
                      );

                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() =>
                          setCredentialForm({
                            ...credentialForm,
                            reminderDays: selected
                              ? credentialForm.reminderDays.filter(
                                  (value) =>
                                    value !== day,
                                )
                              : [
                                  ...credentialForm.reminderDays,
                                  day,
                                ].sort(
                                  (a, b) => b - a,
                                ),
                          })
                        }
                        className={`rounded-full border px-3 py-1.5 text-xs ${
                          selected
                            ? "border-blue-500/50 bg-blue-500/15 text-blue-200"
                            : "border-slate-700 text-slate-500"
                        }`}
                      >
                        {day === 0
                          ? "On expiration"
                          : `${day} days`}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <label className="text-sm text-slate-300 md:col-span-2">
                Notes
                <textarea
                  rows={4}
                  value={credentialForm.notes}
                  onChange={(event) =>
                    setCredentialForm({
                      ...credentialForm,
                      notes: event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                />
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-800 px-6 py-4">
              <button
                type="button"
                onClick={() =>
                  setCredentialModalOpen(false)
                }
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300"
              >
                Cancel
              </button>

              <button
                disabled={saving}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving
                  ? "Saving..."
                  : "Save Certification"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {typeModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={saveType}
            className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {typeForm.certificationTypeId
                    ? "Edit Certification Type"
                    : "New Certification Type"}
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Define the credential itself. Agency
                  requirements are configured separately.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setTypeModalOpen(false)
                }
                className="text-slate-500 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid gap-5 p-6 md:grid-cols-2">
              <label className="text-sm text-slate-300">
                Name
                <input
                  required
                  value={typeForm.name}
                  onChange={(event) =>
                    setTypeForm({
                      ...typeForm,
                      name: event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                  placeholder="CPR/AED"
                />
              </label>

              <label className="text-sm text-slate-300">
                Category
                <input
                  required
                  value={typeForm.category}
                  onChange={(event) =>
                    setTypeForm({
                      ...typeForm,
                      category: event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                  placeholder="Medical"
                />
              </label>

              <label className="text-sm text-slate-300 md:col-span-2">
                Description
                <input
                  value={typeForm.description}
                  onChange={(event) =>
                    setTypeForm({
                      ...typeForm,
                      description:
                        event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                />
              </label>

              <label className="text-sm text-slate-300 md:col-span-2">
                Default issuing organization
                <input
                  value={
                    typeForm.issuingOrganization
                  }
                  onChange={(event) =>
                    setTypeForm({
                      ...typeForm,
                      issuingOrganization:
                        event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                />
              </label>

              <label className="flex items-center gap-3 text-sm text-slate-300 md:col-span-2">
                <input
                  type="checkbox"
                  checked={
                    typeForm.expirationRequired
                  }
                  onChange={(event) =>
                    setTypeForm({
                      ...typeForm,
                      expirationRequired:
                        event.target.checked,
                    })
                  }
                  className="h-4 w-4"
                />
                Expiration date required
              </label>

              <label className="text-sm text-slate-300">
                Default validity days
                <input
                  type="number"
                  min="1"
                  value={
                    typeForm.defaultValidDays
                  }
                  onChange={(event) =>
                    setTypeForm({
                      ...typeForm,
                      defaultValidDays:
                        event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                  placeholder="Optional"
                />
              </label>

              <label className="text-sm text-slate-300">
                Default warning days
                <input
                  required
                  type="number"
                  min="0"
                  value={
                    typeForm.defaultDueSoonDays
                  }
                  onChange={(event) =>
                    setTypeForm({
                      ...typeForm,
                      defaultDueSoonDays:
                        event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                />
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-800 px-6 py-4">
              <button
                type="button"
                onClick={() =>
                  setTypeModalOpen(false)
                }
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300"
              >
                Cancel
              </button>

              <button
                disabled={saving}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Type"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {requirementModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={saveRequirement}
            className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Agency Requirement
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  {
                    typeMap.get(
                      requirementForm.certificationTypeId,
                    )?.name
                  }
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setRequirementModalOpen(false)
                }
                className="text-slate-500 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid gap-5 p-6 md:grid-cols-2">
              <label className="flex items-center gap-3 text-sm text-slate-300 md:col-span-2">
                <input
                  type="checkbox"
                  checked={
                    requirementForm.isRequired
                  }
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      isRequired:
                        event.target.checked,
                    })
                  }
                  className="h-4 w-4"
                />
                Required for agency readiness
              </label>

              <label className="text-sm text-slate-300">
                Validity override
                <input
                  type="number"
                  min="1"
                  value={
                    requirementForm.validDays
                  }
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      validDays:
                        event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                  placeholder="Use type default"
                />
              </label>

              <label className="text-sm text-slate-300">
                Warning override
                <input
                  type="number"
                  min="0"
                  value={
                    requirementForm.dueSoonDays
                  }
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      dueSoonDays:
                        event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                  placeholder="Use type default"
                />
              </label>

              <label className="flex items-center gap-3 text-sm text-slate-300 md:col-span-2">
                <input
                  type="checkbox"
                  checked={
                    requirementForm.isActive
                  }
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      isActive:
                        event.target.checked,
                    })
                  }
                  className="h-4 w-4"
                />
                Requirement active
              </label>

              <label className="text-sm text-slate-300 md:col-span-2">
                Notes
                <textarea
                  rows={3}
                  value={requirementForm.notes}
                  onChange={(event) =>
                    setRequirementForm({
                      ...requirementForm,
                      notes: event.target.value,
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
                />
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-800 px-6 py-4">
              <button
                type="button"
                onClick={() =>
                  setRequirementModalOpen(false)
                }
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300"
              >
                Cancel
              </button>

              <button
                disabled={saving}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving
                  ? "Saving..."
                  : "Save Requirement"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </TracePointShell>
  );
}
