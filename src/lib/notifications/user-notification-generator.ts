/* eslint-disable @typescript-eslint/no-explicit-any -- collectors moved unchanged from src/app/api/notifications/route.ts (B6) */
import "server-only";

import { collectFleetNotifications } from "@/lib/tracepoint/fleet-notifications";
import { collectAgencyTrainingNotifications } from "@/lib/tracepoint/agency-training-notifications";

import { hasAnyServerPermission, type ServerAccessContext } from "@/lib/tracepoint/server-access";

import {
  evaluateCertificationReadiness,
} from "@/lib/tracepoint/certification-readiness";

import {
  evaluateCanonicalQualificationReadiness,
  type QualificationComponent,
} from "@/lib/tracepoint/qualification-readiness";
import { resolvePostgresAccess } from "@/lib/tracepoint/server-access-postgres";
import { createNotificationReadRepository } from "@/lib/notifications/read-repository";
import type { GenerationOutcome, GenerationTarget } from "@/lib/notifications/generation-run-core";
import { createNotificationEventWriter } from "@/lib/notifications/event-writer";
import { notificationDateValue } from "@/lib/notifications/date-value";
import {
  buildNotificationEventReconciliationRow,
  notificationEventShouldResolve,
} from "@/lib/notifications/event-reconciliation";

// Per-user alert generation, shared by GET /api/notifications (the signed-in
// user) and the scheduled generation run (each active member, TRN-01).
type Priority = "Critical" | "High" | "Normal";
type Source =
  | "Personal Rifle"
  | "Ammunition"
  | "Inspection"
  | "Range"
  | "Training"
  | "Qualifications"
  | "Equipment"
  | "Fleet";

type GeneratedAlert = {
  key: string;
  source: Source;
  kind: string;
  title: string;
  detail: string;
  href: string;
  priority: Priority;
  createdAt?: string | null;
  emailEnabled?: boolean;
};

type ExistingNotificationEvent = {
  notification_key?: string | null;
  fingerprint?: string | null;
  first_seen_at?: string | null;
  acknowledged_at?: string | null;
  snoozed_until?: string | null;
  resolved_at?: string | null;
  source?: string | null;
  id?: string | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function get(record: any, ...keys: string[]) {
  for (const key of keys) {
    if (record?.[key] !== undefined && record?.[key] !== null) return record[key];
  }
  return undefined;
}

function list(record: any, ...keys: string[]) {
  const candidate = get(record, ...keys);
  return Array.isArray(candidate) ? candidate : [];
}

const dateValue = notificationDateValue;

// The AWS-native pg driver returns DATE columns as local-midnight Date objects;
// the readiness evaluator expects the provider's YYYY-MM-DD text.
function calendarDate(value: unknown) {
  if (!(value instanceof Date)) return (value as string | null | undefined) ?? null;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function getDigestSchedule(mode: unknown, now: Date) {
  const normalizedMode = text(mode);

  if (normalizedMode === "Immediate") {
    return now.toISOString();
  }

  const scheduled = new Date(now);
  scheduled.setUTCHours(13, 0, 0, 0);

  if (normalizedMode === "Weekly") {
    const daysUntilMonday =
      (8 - scheduled.getUTCDay()) % 7;

    scheduled.setUTCDate(
      scheduled.getUTCDate() + daysUntilMonday,
    );

    if (scheduled.getTime() <= now.getTime()) {
      scheduled.setUTCDate(scheduled.getUTCDate() + 7);
    }

    return scheduled.toISOString();
  }

  if (scheduled.getTime() <= now.getTime()) {
    scheduled.setUTCDate(scheduled.getUTCDate() + 1);
  }

  return scheduled.toISOString();
}

export type NotificationSourceResult = { ok: boolean; payload: any; error: string; status: number };
// Reads a session-bound internal source route. The scheduled run has no
// session, so its reader reports those sources unavailable; unavailable
// sources generate nothing and resolve nothing.
export type NotificationSourceReader = (path: string) => Promise<NotificationSourceResult>;

export function notificationContext(accessContext: ServerAccessContext) {
  const canManageArmory = hasAnyServerPermission(
    accessContext,
    [
      "manage_firearms",
      "manage_inspections",
      "view_command_dashboard",
    ],
  );
  const canViewAmmunition = hasAnyServerPermission(accessContext, ["manage_firearms"]);

  const canManageRange = hasAnyServerPermission(
    accessContext,
    [
      "manage_range_days",
      "score_range_days",
      "manage_qualifications",
      "view_command_dashboard",
    ],
  );

  const canViewDepartmentReadiness = hasAnyServerPermission(
    accessContext,
    [
      "manage_qualifications",
      "manage_certifications",
      "manage_equipment",
      "view_command_dashboard",
      "view_analytics",
    ],
  );

  return {
    ...accessContext,
    canManageArmory,
    canViewAmmunition,
    canManageRange,
    canViewDepartmentReadiness,
  } as const;
}

function collectPersonalRifles(payload: any): GeneratedAlert[] {
  return list(payload, "items").map((item: any) => ({
    key: text(item.id) || `personal-rifle-${text(item.rifleId)}`,
    source: "Personal Rifle",
    kind: text(item.kind) || "personal_rifle",
    title: text(item.title) || "Personal Rifle Action Required",
    detail: text(item.detail) || "Open the personal rifle record.",
    href: text(item.href) || "/firearms/personal-rifles",
    priority: item.priority === "Critical" ? "Critical" : item.priority === "Normal" ? "Normal" : "High",
    createdAt: text(item.createdAt) || null,
  }));
}

function collectAmmunition(payload: any): GeneratedAlert[] {
  const workspace = payload?.workspace ?? payload ?? {};
  const types = [workspace.ammoTypes, workspace.ammunitionTypes, workspace.types].find(Array.isArray) ?? [];
  const alerts: GeneratedAlert[] = [];

  for (const item of types) {
    if (item?.isActive === false) continue;
    const id = text(get(item, "id", "ammoTypeId")) || text(item.name);
    const name = text(get(item, "name", "label", "caliber")) || "Ammunition";
    const onHand = Math.max(0, Math.trunc(numeric(get(item, "currentOnHand", "current_on_hand", "onHand", "quantityOnHand"))));
    const threshold = Math.max(0, Math.trunc(numeric(get(item, "reorderThreshold", "reorder_threshold", "lowStockThreshold"))));

    if (threshold > 0 && onHand <= threshold) {
      alerts.push({
        key: `ammunition-reorder-${id}`,
        source: "Ammunition",
        kind: "ammunition_reorder",
        title: `${name} Reorder Required`,
        detail: `${onHand.toLocaleString()} ${text(get(item, "unitLabel", "unit_label")) || "rounds"} remain. Reorder point: ${threshold.toLocaleString()}.`,
        href: "/firearms/ammunition",
        priority: onHand === 0 ? "Critical" : "High",
        createdAt: text(get(item, "updatedAt", "updated_at")) || null,
      });
    }

    const nextCount = text(get(item, "nextVerificationDate", "next_verification_date"));
    if (nextCount && dateValue(nextCount) <= Date.now()) {
      alerts.push({
        key: `ammunition-count-${id}`,
        source: "Ammunition",
        kind: "ammunition_physical_count_due",
        title: `${name} Physical Count Due`,
        detail: `The configured physical-count date was ${nextCount}.`,
        href: "/firearms/ammunition",
        priority: "High",
        createdAt: nextCount,
      });
    }
  }

  return alerts;
}

function collectInspections(payload: any, context: any): GeneratedAlert[] {
  const alerts: GeneratedAlert[] = [];

  for (const firearm of list(payload, "firearms")) {
    const status = text(get(firearm, "condition_status", "conditionStatus"));
    if (!["Inspection Required", "Maintenance", "Out of Service"].includes(status)) continue;

    const assignment = firearm.active_assignment ?? firearm.activeAssignment ?? null;
    const assignedUserId = text(get(assignment, "assigned_to_user_id", "assignedToUserId"));
    if (!context.canManageArmory && assignedUserId !== context.user.id) continue;

    const id = text(firearm.id);
    const name = [text(firearm.make), text(firearm.model)].filter(Boolean).join(" ") || "Firearm";
    const serial = text(firearm.serial_number) || "serial not recorded";

    alerts.push({
      key: `firearm-condition-${id}`,
      source: "Inspection",
      kind: status === "Out of Service" ? "firearm_out_of_service" : status === "Maintenance" ? "firearm_maintenance" : "firearm_inspection_required",
      title: status === "Out of Service" ? "Firearm Out of Service" : status === "Maintenance" ? "Firearm Maintenance Required" : "Firearm Inspection Required",
      detail: `${name} | SN ${serial} | ${status}`,
      href: id ? `/firearms/${id}` : "/firearms/inspections",
      priority: status === "Out of Service" ? "Critical" : "High",
      createdAt: text(firearm.updated_at) || null,
    });
  }

  return alerts;
}

function collectRange(payload: any, context: any): GeneratedAlert[] {
  const workspace = payload?.workspace ?? payload ?? {};
  const rangeDays = list(workspace, "rangeDays", "range_days");
  const roster = list(workspace, "rangeRoster", "range_roster");
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const alerts: GeneratedAlert[] = [];

  for (const day of rangeDays) {
    const id = text(day.id);
    const status = text(day.status);
    const date = text(day.date);
    const scheduled = dateValue(date);
    if (!id || !scheduled || ["Archived", "Completed", "Cancelled"].includes(status)) continue;

    const title = text(day.title) || "Range Day";
    const location = text(day.location) || "Location not set";
    const lead = text(get(day, "leadInstructorId", "lead_instructor_id"));
    const instructors = list(day, "instructorIds", "instructor_ids").map(String);
    const rostered = roster.some((entry: any) =>
      text(get(entry, "rangeDayId", "range_day_id")) === id &&
      text(get(entry, "officerId", "officer_id")) === context.user.id,
    );
    const isInstructor = lead === context.user.id || instructors.includes(context.user.id);

    if ((rostered || isInstructor) && scheduled >= todayStart) {
      alerts.push({
        key: `range-assignment-${id}`,
        source: "Range",
        kind: isInstructor ? "range_instructor_assignment" : "range_officer_assignment",
        title: isInstructor ? "Instructor Range Assignment" : "Upcoming Range Assignment",
        detail: `${title} | ${date} | ${location}`,
        href: "/range-days",
        priority: "Normal",
        createdAt: date,
      });
    }

    const packet = text(get(day, "packetStatus", "packet_status"));
    if (context.canManageRange && scheduled >= todayStart && scheduled <= todayStart + 7 * 86400000 && packet && packet !== "Ready") {
      alerts.push({
        key: `range-packet-${id}`,
        source: "Range",
        kind: "range_packet_not_ready",
        title: "Range Packet Not Ready",
        detail: `${title} is scheduled for ${date}. Packet status: ${packet}.`,
        href: "/range-days",
        priority: "High",
        createdAt: date,
      });
    }
  }

  return alerts;
}

async function collectCertificationReadiness(
  context: any,
): Promise<GeneratedAlert[]> {
  const data = await createNotificationReadRepository(context.admin, context.departmentId, context.user.id).getCertificationReadiness(context.departmentId, context.user.id, context.canViewDepartmentReadiness);
  const memberships = data.memberships;
  const typesResult = { data: data.certificationTypes };
  const requirementsResult = { data: data.requirements };
  const credentialsResult = { data: data.credentials };
  const profiles = data.profiles;

  const profileMap = new Map(
    profiles.map((profile: any) => [
      String(profile.id),
      profile,
    ]),
  );

  const members = memberships.map((membership: any) => {
    const profile = profileMap.get(
      String(membership.user_id),
    );

    return {
      userId: String(membership.user_id),
      fullName:
        text(profile?.full_name) ||
        text(membership.rank_title) ||
        "Unnamed Officer",
      badgeNumber: membership.badge_number ?? null,
      rankTitle: membership.rank_title ?? null,
    };
  });

  const certificationTypes = (
    typesResult.data ?? []
  ).map((row: any) => ({
    id: String(row.id),
    name: String(row.name),
    category: String(row.category ?? "General"),
    expirationRequired:
      row.expiration_required !== false,
    defaultValidDays:
      row.default_valid_days === null ||
      row.default_valid_days === undefined
        ? null
        : Number(row.default_valid_days),
    defaultDueSoonDays: Number(
      row.default_due_soon_days ?? 30,
    ),
  }));

  const requirements = (
    requirementsResult.data ?? []
  ).map((row: any) => ({
    certificationTypeId: String(
      row.certification_type_id,
    ),
    isRequired: row.is_required !== false,
    isActive: row.is_active !== false,
    validDays:
      row.valid_days === null ||
      row.valid_days === undefined
        ? null
        : Number(row.valid_days),
    dueSoonDays:
      row.due_soon_days === null ||
      row.due_soon_days === undefined
        ? null
        : Number(row.due_soon_days),
  }));

  const credentials = (
    credentialsResult.data ?? []
  )
    .filter(
      (row: any) => row.certification_type_id,
    )
    .map((row: any) => ({
      id: String(row.id),
      userId: String(row.user_id),
      certificationTypeId: String(
        row.certification_type_id,
      ),
      issueDate: calendarDate(row.issue_date),
      expirationDate: calendarDate(row.expiration_date),
      isActive: row.is_active !== false,
    }));

  const readinessRows =
    evaluateCertificationReadiness({
      members,
      certificationTypes,
      requirements,
      credentials,
    });

  const alerts: GeneratedAlert[] = [];

  for (const row of readinessRows) {
    if (row.status === "current") continue;

    if (row.userId !== context.user.id) continue;
if (row.status === "missing") {
      alerts.push({
        key: `certification-readiness-${row.userId}-${row.certificationTypeId}`,
        source: "Training",
        kind: "required_certification_missing",
        title: `${row.certificationName} Missing`,
        detail:
          "A required certification is not currently recorded.",
        href: "/training/certifications",
        priority: "Critical",
        createdAt: null,
      });

      continue;
    }

    if (row.status === "expired") {
      alerts.push({
        key: `certification-readiness-${row.userId}-${row.certificationTypeId}`,
        source: "Training",
        kind: "required_certification_expired",
        title: `${row.certificationName} Expired`,
        detail: row.statusReason,
        href: "/training/certifications",
        priority: "Critical",
        createdAt: row.expirationDate,
      });

      continue;
    }

    if (row.status === "due_soon") {
      alerts.push({
        key: `certification-readiness-${row.userId}-${row.certificationTypeId}`,
        source: "Training",
        kind: "required_certification_due_soon",
        title: `${row.certificationName} Due Soon`,
        detail: row.statusReason,
        href: "/training/certifications",
        priority: "High",
        createdAt: row.expirationDate,
      });
    }
  }

  return alerts;
}

function hasQualificationActivity(rangePayload: any) {
  const workspace =
    rangePayload?.workspace ?? rangePayload ?? {};

  const drills = list(
    workspace,
    "rangeDayDrills",
    "range_day_drills",
  );

  const results = list(workspace, "results");

  const drillsById = new Map(
    drills.map((drill: any) => [text(drill.id), drill]),
  );

  return results.some((result: any) => {
    const drillId = text(
      get(result, "drillId", "drill_id"),
    );

    const drill = drillsById.get(drillId);
    const category = text(drill?.category).toLowerCase();
    const name = text(drill?.name).toLowerCase();

    return (
      category === "qualification" ||
      name.includes("qualification")
    );
  });
}

function collectQualificationReadiness(
  rangePayload: any,
  personnelPayload: any,
  rulesPayload: any,
  authoritativeResults: any[],
  context: any,
): GeneratedAlert[] {
  const personnel =
    [personnelPayload?.personnel, personnelPayload?.items]
      .find(Array.isArray) ?? [];

  const rules = rulesPayload?.rules ?? {};
  const storedQualificationResults = Array.isArray(authoritativeResults)
    ? authoritativeResults
    : [];

  const qualificationValidDays =
    Number(rules.qualification_valid_days) || 365;

  const qualificationDueSoonDays =
    Number(rules.qualification_due_soon_days) || 30;
  const requiredComponents = Array.isArray(
    rules.required_handgun_qualification_components,
  )
    ? rules.required_handgun_qualification_components.filter(
        (component: unknown): component is QualificationComponent =>
          component === "day" || component === "night",
      )
    : (["day", "night"] as QualificationComponent[]);

  const alerts: GeneratedAlert[] = [];

  for (const person of personnel) {
    if (
      person?.isActive === false ||
      person?.is_active === false
    ) {
      continue;
    }

    const officerId = text(person.id);
    const userId = text(get(person, "userId", "user_id"));

    if (!officerId) continue;

    if (userId !== context.user.id) {
      continue;
    }

    const readiness = evaluateCanonicalQualificationReadiness({
      workspace: rangePayload,
      qualificationResults: storedQualificationResults,
      officerId,
      officerUserId: userId,
      scope: { requiredComponents },
      qualificationValidDays,
      qualificationDueSoonDays,
    });

    if (readiness.status === "Current") continue;

    
    const base = {
      key: `qualification-readiness-${userId || officerId}-${readiness.scopeKey}`,
      source: "Qualifications" as Source,
      href: "/qualifications",
      detail: readiness.statusReason,
    };

    const createdAt =
      readiness.matchingAttempts.find(
        (attempt) => readiness.status === "Failed" && attempt.passed === false,
      )?.date ??
      readiness.matchingAttempts.at(-1)?.date ??
      null;

    const config = {
      "No Record": {
        kind: "qualification_no_record",
        title: "Qualification Record Missing",
        priority: "Critical" as Priority,
      },
      "Missing Day": {
        kind: "qualification_missing_day",
        title: "Day Qualification Missing",
        priority: "Critical" as Priority,
      },
      "Missing Night": {
        kind: "qualification_missing_night",
        title: "Night Qualification Missing",
        priority: "Critical" as Priority,
      },
      Failed: {
        kind: "qualification_failed",
        title: "Qualification Failed",
        priority: "Critical" as Priority,
      },
      Overdue: {
        kind: "qualification_overdue",
        title: "Qualification Overdue",
        priority: "Critical" as Priority,
      },
      "Due Soon": {
        kind: "qualification_due_soon",
        title: "Qualification Due Soon",
        priority: "High" as Priority,
      },
    }[readiness.status];

    if (!config) continue;

    alerts.push({
      ...base,
      kind: config.kind,
      title: config.title,
      priority: config.priority,
      createdAt,
    });
  }

  return alerts;
}
function collectEquipmentReadiness(
  payload: any,
  context: any,
): GeneratedAlert[] {
  const rows = Array.isArray(payload?.rows)
    ? payload.rows
    : [];

  const departmentScope =
    text(payload?.scope) === "department" &&
    context.canViewDepartmentReadiness;

  const alerts: GeneratedAlert[] = [];

  for (const row of rows) {
    const status = text(row.status);

    if (!status || status === "current") continue;

    const userId = text(row.userId);
    const equipmentTypeId = text(row.equipmentTypeId);

    if (!userId || !equipmentTypeId) continue;

    const equipmentName =
      text(row.equipmentName) || "Required Equipment";

    if (userId !== context.user.id) continue;

    const base = {
      key: `equipment-readiness-${userId}-${equipmentTypeId}`,
      source: "Equipment" as Source,
      href: "/equipment",
    };

    if (status === "missing") {
      alerts.push({
        ...base,
        kind: "required_equipment_missing",
        title: `${equipmentName} Missing`,
        detail:
          text(row.statusReason) ||
          "Required equipment is not currently assigned.",
        priority: "Critical",
        createdAt: null,
      });
      continue;
    }

    if (status === "expired") {
      alerts.push({
        ...base,
        kind: "required_equipment_expired",
        title: `${equipmentName} Expired`,
        detail: text(row.statusReason),
        priority: "Critical",
        createdAt:
          row.assets?.find(
            (asset: any) => text(asset.status) === "expired",
          )?.expirationDate ?? null,
      });
      continue;
    }

    if (status === "inspection_overdue") {
      alerts.push({
        ...base,
        kind: "equipment_inspection_overdue",
        title: `${equipmentName} Inspection Overdue`,
        detail: text(row.statusReason),
        priority: "Critical",
        createdAt:
          row.assets?.find(
            (asset: any) =>
              text(asset.status) === "inspection_overdue",
          )?.nextInspectionDate ?? null,
      });
      continue;
    }

    if (status === "out_of_service") {
      alerts.push({
        ...base,
        kind: "required_equipment_out_of_service",
        title: `${equipmentName} Out of Service`,
        detail: text(row.statusReason),
        priority: "Critical",
        createdAt: null,
      });
      continue;
    }

    if (status === "due_soon") {
      alerts.push({
        ...base,
        kind: "equipment_expiration_due_soon",
        title: `${equipmentName} Expiring Soon`,
        detail: text(row.statusReason),
        priority: "High",
        createdAt:
          row.assets?.find(
            (asset: any) => text(asset.status) === "due_soon",
          )?.expirationDate ?? null,
      });
      continue;
    }

    if (status === "inspection_due_soon") {
      alerts.push({
        ...base,
        kind: "equipment_inspection_due_soon",
        title: `${equipmentName} Inspection Due Soon`,
        detail: text(row.statusReason),
        priority: "High",
        createdAt:
          row.assets?.find(
            (asset: any) =>
              text(asset.status) === "inspection_due_soon",
          )?.nextInspectionDate ?? null,
      });
    }
  }

  return alerts;
}
async function getPreferences(context: any) {
  const data = await createNotificationReadRepository(context.admin, context.departmentId, context.user.id).getPreferences(context.departmentId, context.user.id);

  return {
    // The Inbox always stays active; preferences PUT stores true (TRN-35).
    in_app_enabled: true,
    email_enabled: data?.email_enabled ?? true,
    critical_email_only: data?.critical_email_only ?? true,
    digest_mode:
      data?.digest_mode === "Immediate" ||
      data?.digest_mode === "Daily" ||
      data?.digest_mode === "Weekly"
        ? data.digest_mode
        : "Daily",
    source_preferences: {
      "Personal Rifle": true,
      Ammunition: true,
      Inspection: true,
      Range: true,
      Training: true,
      Qualifications: true,
      Equipment: true,
      Fleet: true,
      ...((data?.source_preferences ?? {}) as Record<string, boolean>),
    },
  };
}

async function getNotificationRecipientEmail(context: any) {
  const sessionEmail = text(context?.user?.email);

  if (sessionEmail) return sessionEmail;

  const userId = text(context?.user?.id) || text(context?.userId);

  if (!userId) {
    throw new Error(
      "Notification email could not be queued because the current user ID is unavailable.",
    );
  }

  const { data, error } =
    await context.admin.auth.admin.getUserById(userId);

  if (error) {
    throw new Error(
      `Notification recipient lookup failed: ${error.message}`,
    );
  }

  const recipientEmail = text(data?.user?.email);

  if (!recipientEmail) {
    throw new Error(
      "Notification email could not be queued because the current user has no email address.",
    );
  }

  return recipientEmail;
}

export async function reconcileUserNotifications(context: ReturnType<typeof notificationContext>, readSource: NotificationSourceReader) {
  const preferences = await getPreferences(context);
  const notificationRecipientEmail =
    preferences.email_enabled
      ? await getNotificationRecipientEmail(context)
      : "";
  const [
    rifles,
    ammunition,
    firearms,
    range,
    training,
    equipment,
    personnel,
    rules,
    qualificationHistory,
  ] = await Promise.all([
    readSource("/api/armory/personal-rifles/inbox"),
    context.canViewAmmunition
      ? readSource("/api/pilot/ammunition")
      : Promise.resolve(null),
    readSource("/api/armory/firearms"),
    readSource("/api/pilot/range-workspace"),
    collectCertificationReadiness(context)
      .then((items) => ({
        ok: true,
        items,
        error: "",
      }))
      .catch((error) => ({
        ok: false,
        items: [] as GeneratedAlert[],
        error:
          error instanceof Error
            ? error.message
            : "Unavailable",
      })),
    context.enabledFeatures.includes("equipment_readiness")
      ? readSource("/api/readiness/equipment")
      : Promise.resolve({
          ok: true,
          payload: { rows: [] },
          error: "",
        }),
    readSource("/api/pilot/personnel"),
    readSource("/api/settings/current-rules"),
    createNotificationReadRepository(context.admin, context.departmentId, context.user.id)
      .listQualificationResults(context.departmentId, context.user.id)
      .then((items) => ({ ok: true, items, error: "" }))
      .catch((error) => ({ ok: false, items: [], error: error instanceof Error ? error.message : "Unavailable" })),
  ]);

  const agencyTraining = await collectAgencyTrainingNotifications(context)
    .then((items) => ({ ok: true, items, error: "" }))
    .catch((error) => ({
      ok: false,
      items: [] as GeneratedAlert[],
      error: error instanceof Error ? error.message : "Unavailable",
    }));

  const generated: GeneratedAlert[] = [];
  const successful = new Set<string>();
  const sourceErrors: Array<{ source: string; error: string }> = [];
  try {
    const fleetItems = await collectFleetNotifications(context);
    successful.add("Fleet");
    generated.push(...fleetItems);
  } catch (fleetError) {
    sourceErrors.push({ source: "Fleet", error: fleetError instanceof Error ? fleetError.message : "Unavailable" });
  }

  if (rifles.ok) { successful.add("Personal Rifle"); generated.push(...collectPersonalRifles(rifles.payload)); }
  else sourceErrors.push({ source: "Personal Rifle", error: rifles.error || "Unavailable" });

  if (ammunition === null) { successful.add("Ammunition"); }
  else if (ammunition.ok) { successful.add("Ammunition"); generated.push(...collectAmmunition(ammunition.payload)); }
  else sourceErrors.push({ source: "Ammunition", error: ammunition.error || "Unavailable" });

  if (firearms.ok) { successful.add("Inspection"); generated.push(...collectInspections(firearms.payload, context)); }
  else sourceErrors.push({ source: "Inspection", error: firearms.error || "Unavailable" });

  if (range.ok) { successful.add("Range"); generated.push(...collectRange(range.payload, context)); }
  else sourceErrors.push({ source: "Range", error: range.error || "Unavailable" });

  if (
    range.ok &&
    personnel.ok &&
    rules.ok &&
    qualificationHistory.ok
  ) {
    successful.add("Qualifications");
    generated.push(
      ...collectQualificationReadiness(
        range.payload,
        personnel.payload,
        rules.payload,
        qualificationHistory.items,
        context,
      ),
    );
  } else {
    sourceErrors.push({
      source: "Qualifications",
      error:
        range.error ||
        personnel.error ||
        rules.error ||
        qualificationHistory.error ||
        "Unavailable",
    });
  }

  if (training.ok && agencyTraining.ok) {
    successful.add("Training");
    generated.push(...training.items, ...agencyTraining.items);
  } else {
    sourceErrors.push({
      source: "Training",
      error: training.error || agencyTraining.error || "Unavailable",
    });
  }


  if (equipment.ok) {
    successful.add("Equipment");

    generated.push(
      ...collectEquipmentReadiness(
        equipment.payload,
        context,
      ),
    );
  } else {
    sourceErrors.push({
      source: "Equipment",
      error: equipment.error || "Unavailable",
    });
  }
  if (process.env.TRACEPOINT_NOTIFICATION_MODE === "shadow" && sourceErrors.length) {
    const responses = new Map([
      ["Personal Rifle", rifles], ["Ammunition", ammunition],
      ["Inspection", firearms], ["Range", range],
      ["Personnel", personnel], ["Rules", rules],
    ]);
    console.warn(JSON.stringify({
      event: "shadow_home_read_sources_unavailable",
      sources: sourceErrors.map(({ source, error }) => ({
        source,
        status: responses.get(source)?.status ?? null,
        category: /not enabled|feature disabled/i.test(error) ? "feature_disabled"
          : /permission|forbidden|not authorized/i.test(error) ? "authorization"
          : /PostgreSQL data operation failed/i.test(error) ? "postgres_operation"
          : /Unsupported data provider/i.test(error) ? "provider_unsupported"
          : "other",
      })),
    }));
  }
  const filtered = generated.filter((item) => preferences.source_preferences[item.source] !== false);

  const nowDate = new Date();
  const now = nowDate.toISOString();

  const qualificationEmailReady =
    range.ok &&
    hasQualificationActivity(range.payload);

  const emailScheduledFor = getDigestSchedule(
    preferences.digest_mode,
    nowDate,
  );
  const existing = await createNotificationReadRepository(context.admin, context.departmentId, context.user.id).listNotificationEvents(context.departmentId, context.user.id);
  const byKey = new Map<string, ExistingNotificationEvent>(
    (existing ?? []).map(
      (row: ExistingNotificationEvent): [string, ExistingNotificationEvent] => [
        String(row.notification_key),
        row,
      ],
    ),
  );
  const eventWriter = createNotificationEventWriter(context.admin, context.departmentId, context.user.id);

  for (const item of filtered) {
    const prior = byKey.get(item.key);
    const reconciliation = buildNotificationEventReconciliationRow({
      departmentId: context.departmentId,
      userId: context.user.id,
      item,
      prior,
      now,
    });
    const { fingerprint } = reconciliation;
    await eventWriter.upsertEvent(reconciliation.row);

    if (
      preferences.email_enabled &&
      item.emailEnabled !== false &&
      (
        !preferences.critical_email_only ||
        item.priority === "Critical"
      ) &&
      (
        item.source !== "Qualifications" ||
        qualificationEmailReady
      ) &&
      notificationRecipientEmail
    ) {
      try { await eventWriter.upsertEmail({
        department_id: context.departmentId,
        user_id: context.user.id,
        recipient_email: notificationRecipientEmail,
        notification_key: item.key,
        fingerprint,
        subject: `[TracePoint] ${item.title}`,
        body_text: `${item.title}\n\n${item.detail}\n\nOpen TracePoint: ${item.href}`,
        scheduled_for: emailScheduledFor,
        status: "Pending",
        updated_at: now,
      }); } catch (queueError) {
        throw new Error(
          `Notification email could not be queued: ${queueError instanceof Error ? queueError.message : "Unknown error"}`,
        );
      }
    }
  }

  const activeKeys = new Set(filtered.map((item) => item.key));
  for (const row of existing ?? []) {
    if (notificationEventShouldResolve({
      event: row,
      successfulSources: successful,
      activeKeys,
    })) {
      await eventWriter.resolveEvent(String(row.id), now);
    }
  }

  return { preferences, sourceErrors };
}

const unavailableWithoutSession: NotificationSourceReader = async () => ({
  ok: false, payload: null, error: "Unavailable to scheduled generation.", status: 0,
});

// Generates one member's alerts in that member's own subject-bound session,
// exactly as their GET /api/notifications would, without a request (TRN-01).
// Sources that are only readable through session-bound routes are skipped.
export async function generateMemberNotifications(target: GenerationTarget): Promise<GenerationOutcome> {
  const access = await resolvePostgresAccess(
    { userId: target.userId, provider: "cognito", issuer: "", subject: "", email: "", fullName: "" },
    target.departmentId,
    "",
  );
  if (!access.ok || access.context.departmentId !== target.departmentId || access.context.isSupportMode) return "skipped";
  await reconcileUserNotifications(notificationContext(access.context as ServerAccessContext), unavailableWithoutSession);
  return "generated";
}
