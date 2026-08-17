import { NextRequest, NextResponse } from "next/server";

import {
  hasAnyServerPermission,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

import {
  evaluateCertificationReadiness,
} from "@/lib/tracepoint/certification-readiness";

import {
  evaluateQualificationReadiness,
} from "@/lib/tracepoint/qualification-readiness";

type Priority = "Critical" | "High" | "Normal";
type Source =
  | "Personal Rifle"
  | "Ammunition"
  | "Inspection"
  | "Range"
  | "Training"
  | "Qualifications"
  | "Equipment";

type GeneratedAlert = {
  key: string;
  source: Source;
  kind: string;
  title: string;
  detail: string;
  href: string;
  priority: Priority;
  createdAt?: string | null;
};

type ExistingNotificationEvent = {
  notification_key?: string | null;
  fingerprint?: string | null;
  first_seen_at?: string | null;
  acknowledged_at?: string | null;
  snoozed_until?: string | null;
};
const CONDITION_BASED_NOTIFICATION_KINDS = new Set([
  "required_certification_missing",
  "required_certification_expired",
  "required_certification_due_soon",
  "qualification_no_record",
  "qualification_missing_day",
  "qualification_missing_night",
  "qualification_failed",
  "qualification_overdue",
  "qualification_due_soon",
  "required_equipment_missing",
  "required_equipment_expired",
  "equipment_inspection_overdue",
  "required_equipment_out_of_service",
  "equipment_expiration_due_soon",
  "equipment_inspection_due_soon",
]);

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

function dateValue(value?: string | null) {
  if (!value) return 0;
  const parsed = value.includes("T")
    ? new Date(value).getTime()
    : new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function getContext() {
  const access = await resolveServerAccess();

  if (!access.ok) {
    return {
      error: access.error,
      status: access.status,
    } as const;
  }

  const accessContext = access.context;

  const canManageArmory = hasAnyServerPermission(
    accessContext,
    [
      "manage_firearms",
      "manage_inspections",
      "view_command_dashboard",
    ],
  );

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
    canManageRange,
    canViewDepartmentReadiness,
  } as const;
}

async function internalJson(request: Request, path: string) {
  try {
    const response = await fetch(new URL(path, request.url), {
      cache: "no-store",
      headers: request.headers.get("cookie")
        ? { cookie: request.headers.get("cookie") as string }
        : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    return { ok: response.ok, payload, error: text(payload?.error) };
  } catch (error) {
    return { ok: false, payload: null, error: error instanceof Error ? error.message : "Source failed." };
  }
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
      detail: `${name} ÃƒÆ’Ã¢â‚¬Å¡Ã‚Â· SN ${serial} ÃƒÆ’Ã¢â‚¬Å¡Ã‚Â· ${status}`,
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

    if ((rostered || isInstructor) && scheduled >= todayStart && scheduled <= todayStart + 14 * 86400000) {
      alerts.push({
        key: `range-assignment-${id}`,
        source: "Range",
        kind: isInstructor ? "range_instructor_assignment" : "range_officer_assignment",
        title: isInstructor ? "Instructor Range Assignment" : "Upcoming Range Assignment",
        detail: `${title} ÃƒÆ’Ã¢â‚¬Å¡Ã‚Â· ${date} ÃƒÆ’Ã¢â‚¬Å¡Ã‚Â· ${location}`,
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
  let membershipQuery = context.admin
    .from("department_memberships")
    .select("user_id,badge_number,rank_title,is_active")
    .eq("department_id", context.departmentId)
    .eq("is_active", true);

  if (!context.canViewDepartmentReadiness) {
    membershipQuery = membershipQuery.eq(
      "user_id",
      context.user.id,
    );
  }

  let credentialsQuery = context.admin
    .from("training_certifications")
    .select(
      "id,user_id,certification_type_id,issue_date,expiration_date,is_active",
    )
    .eq("department_id", context.departmentId)
    .eq("is_active", true);

  if (!context.canViewDepartmentReadiness) {
    credentialsQuery = credentialsQuery.eq(
      "user_id",
      context.user.id,
    );
  }

  const [
    membershipsResult,
    typesResult,
    requirementsResult,
    credentialsResult,
  ] = await Promise.all([
    membershipQuery,

    context.admin
      .from("certification_types")
      .select(
        "id,name,category,expiration_required,default_valid_days,default_due_soon_days,is_active",
      )
      .eq("department_id", context.departmentId)
      .eq("is_active", true),

    context.admin
      .from("department_certification_requirements")
      .select(
        "certification_type_id,is_required,is_active,valid_days,due_soon_days",
      )
      .eq("department_id", context.departmentId)
      .eq("is_active", true)
      .eq("is_required", true),

    credentialsQuery,
  ]);

  if (membershipsResult.error) {
    throw new Error(membershipsResult.error.message);
  }

  if (typesResult.error) {
    throw new Error(typesResult.error.message);
  }

  if (requirementsResult.error) {
    throw new Error(requirementsResult.error.message);
  }

  if (credentialsResult.error) {
    throw new Error(credentialsResult.error.message);
  }

  const memberships = membershipsResult.data ?? [];

  const userIds = memberships.map((row: any) =>
    String(row.user_id),
  );

  let profiles: any[] = [];

  if (userIds.length > 0) {
    const { data, error } = await context.admin
      .from("profiles")
      .select("id,full_name")
      .in("id", userIds);

    if (error) {
      throw new Error(error.message);
    }

    profiles = data ?? [];
  }

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
      issueDate: row.issue_date ?? null,
      expirationDate: row.expiration_date ?? null,
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

    const officerPrefix =
      context.canViewDepartmentReadiness &&
      row.userId !== context.user.id
        ? `${row.officerName} Ã‚Â· `
        : "";

    if (row.status === "missing") {
      alerts.push({
        key: `certification-readiness-${row.userId}-${row.certificationTypeId}`,
        source: "Training",
        kind: "required_certification_missing",
        title: `${officerPrefix}${row.certificationName} Missing`,
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
        title: `${officerPrefix}${row.certificationName} Expired`,
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
        title: `${officerPrefix}${row.certificationName} Due Soon`,
        detail: row.statusReason,
        href: "/training/certifications",
        priority: "High",
        createdAt: row.expirationDate,
      });
    }
  }

  return alerts;
}

function collectQualificationReadiness(
  rangePayload: any,
  personnelPayload: any,
  rulesPayload: any,
  context: any,
): GeneratedAlert[] {
  const workspace = rangePayload?.workspace ?? rangePayload ?? {};
  const rangeDays = list(workspace, "rangeDays", "range_days");
  const drills = list(workspace, "rangeDayDrills", "range_day_drills");
  const results = list(workspace, "results");

  const personnel =
    [personnelPayload?.personnel, personnelPayload?.items]
      .find(Array.isArray) ?? [];

  const rules = rulesPayload?.rules ?? {};

  const qualificationValidDays =
    Number(rules.qualification_valid_days) || 365;

  const qualificationDueSoonDays =
    Number(rules.qualification_due_soon_days) || 30;

  const rangeDaysById = new Map(
    rangeDays.map((day: any) => [text(day.id), day]),
  );

  const drillsById = new Map(
    drills.map((drill: any) => [text(drill.id), drill]),
  );

  function isQualificationDrill(drill: any) {
    const category = text(drill?.category).toLowerCase();
    const name = text(drill?.name).toLowerCase();

    return (
      category === "qualification" ||
      name.includes("qualification")
    );
  }

  function isRifleDrill(drill: any) {
    const name = text(drill?.name).toLowerCase();
    const category = text(drill?.category).toLowerCase();
    const firearmType = text(
      get(drill, "firearmType", "firearm_type"),
    ).toLowerCase();

    return (
      name.includes("rifle") ||
      category.includes("rifle") ||
      firearmType.includes("rifle")
    );
  }

  function resultOfficerId(result: any) {
    return text(get(result, "officerId", "officer_id"));
  }

  function resultDrillId(result: any) {
    return text(get(result, "drillId", "drill_id"));
  }

  function resultRangeDayId(result: any) {
    return text(get(result, "rangeDayId", "range_day_id"));
  }

  function resultRunNumber(result: any) {
    return Number(
      get(result, "runNumber", "run_number") ?? 1,
    );
  }

  function isPassed(result: any) {
    return typeof result?.passed === "boolean"
      ? result.passed
      : result?.completed === true;
  }

  const qualificationResults = results.filter((result: any) => {
    const drill = drillsById.get(resultDrillId(result));

    return (
      isQualificationDrill(drill) &&
      !isRifleDrill(drill)
    );
  });

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

    if (
      !context.canViewDepartmentReadiness &&
      userId !== context.user.id
    ) {
      continue;
    }

    const officerName =
      text(
        get(
          person,
          "displayName",
          "display_name",
          "fullName",
          "full_name",
          "name",
        ),
      ) || "Officer";

    const officerResults = qualificationResults
      .filter(
        (result: any) =>
          resultOfficerId(result) === officerId,
      )
      .sort(
        (a: any, b: any) =>
          dateValue(
            get(
              rangeDaysById.get(resultRangeDayId(b)),
              "date",
            ),
          ) -
          dateValue(
            get(
              rangeDaysById.get(resultRangeDayId(a)),
              "date",
            ),
          ),
      );

    const passed = officerResults.filter(isPassed);

    const day = passed.find(
      (result: any) => resultRunNumber(result) === 1,
    );

    const night = passed.find(
      (result: any) => resultRunNumber(result) === 2,
    );

    const failedQualifications = officerResults
      .filter(
        (result: any) => result?.passed === false,
      )
      .map((result: any) => {
        const runNumber = resultRunNumber(result);

        return {
          date:
            text(
              get(
                rangeDaysById.get(
                  resultRangeDayId(result),
                ),
                "date",
              ),
            ) || "",
          runLabel:
            runNumber === 1
              ? "Day Qualification"
              : runNumber === 2
                ? "Night Qualification"
                : `Run ${runNumber}`,
        };
      });

    const lastDayQualification = day
      ? {
          date:
            text(
              get(
                rangeDaysById.get(
                  resultRangeDayId(day),
                ),
                "date",
              ),
            ) || "",
          runLabel: "Day Qualification",
        }
      : undefined;

    const lastNightQualification = night
      ? {
          date:
            text(
              get(
                rangeDaysById.get(
                  resultRangeDayId(night),
                ),
                "date",
              ),
            ) || "",
          runLabel: "Night Qualification",
        }
      : undefined;

    const readiness = evaluateQualificationReadiness({
      lastDayQualification,
      lastNightQualification,
      failedQualifications,
      qualificationValidDays,
      qualificationDueSoonDays,
    });

    if (readiness.status === "Current") continue;

    const officerPrefix =
      context.canViewDepartmentReadiness &&
      userId !== context.user.id
        ? `${officerName} - `
        : "";

    const base = {
      key: `qualification-readiness-${userId || officerId}`,
      source: "Qualifications" as Source,
      href: "/qualifications",
      detail: readiness.statusReason,
    };

    const createdAt =
      readiness.status === "Failed"
        ? failedQualifications[0]?.date ?? null
        : lastDayQualification &&
            lastNightQualification
          ? dateValue(lastDayQualification.date) <
            dateValue(lastNightQualification.date)
            ? lastDayQualification.date
            : lastNightQualification.date
          : lastDayQualification?.date ??
            lastNightQualification?.date ??
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
      title: `${officerPrefix}${config.title}`,
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

    const officerPrefix =
      departmentScope &&
      userId !== context.user.id
        ? `${text(row.officerName) || "Officer"} Ã‚Â· `
        : "";

    const base = {
      key: `equipment-readiness-${userId}-${equipmentTypeId}`,
      source: "Equipment" as Source,
      href: "/equipment",
    };

    if (status === "missing") {
      alerts.push({
        ...base,
        kind: "required_equipment_missing",
        title: `${officerPrefix}${equipmentName} Missing`,
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
        title: `${officerPrefix}${equipmentName} Expired`,
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
        title: `${officerPrefix}${equipmentName} Inspection Overdue`,
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
        title: `${officerPrefix}${equipmentName} Out of Service`,
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
        title: `${officerPrefix}${equipmentName} Expiring Soon`,
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
        title: `${officerPrefix}${equipmentName} Inspection Due Soon`,
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
  const { data, error } = await context.admin
    .from("notification_preferences")
    .select("in_app_enabled,email_enabled,critical_email_only,digest_mode,source_preferences")
    .eq("department_id", context.departmentId)
    .eq("user_id", context.user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return {
    in_app_enabled: data?.in_app_enabled ?? true,
    email_enabled: data?.email_enabled ?? false,
    critical_email_only: data?.critical_email_only ?? true,
    digest_mode: data?.digest_mode === "Daily" || data?.digest_mode === "Weekly" ? data.digest_mode : "Immediate",
    source_preferences: {
      "Personal Rifle": true,
      Ammunition: true,
      Inspection: true,
      Range: true,
      Training: true,
      Qualifications: true,
      Equipment: true,...(data?.source_preferences ?? {}),
    },
  };
}

function sortRows(rows: any[]) {
  const weight = { Critical: 0, High: 1, Normal: 2 };
  return [...rows].sort((a, b) => {
    const priority = weight[a.priority as Priority] - weight[b.priority as Priority];
    if (priority !== 0) return priority;
    return dateValue(b.createdAt || b.lastSeenAt) - dateValue(a.createdAt || a.lastSeenAt);
  });
}

export async function GET(request: NextRequest) {
  const context = await getContext();
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  try {
    const preferences = await getPreferences(context);
    const [
      rifles,
      ammunition,
      firearms,
      range,
      training,
      equipment,
      personnel,
      rules,
    ] = await Promise.all([
      internalJson(request, "/api/armory/personal-rifles/inbox"),
      internalJson(request, "/api/pilot/ammunition"),
      internalJson(request, "/api/armory/firearms"),
      internalJson(request, "/api/pilot/range-workspace"),
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
      internalJson(
        request,
        "/api/readiness/equipment",
      ),
      internalJson(request, "/api/pilot/personnel"),
      internalJson(request, "/api/settings/current-rules"),
    ]);

    const generated: GeneratedAlert[] = [];
    const successful = new Set<string>();
    const sourceErrors: Array<{ source: string; error: string }> = [];

    if (rifles.ok) { successful.add("Personal Rifle"); generated.push(...collectPersonalRifles(rifles.payload)); }
    else sourceErrors.push({ source: "Personal Rifle", error: rifles.error || "Unavailable" });

    if (ammunition.ok) { successful.add("Ammunition"); generated.push(...collectAmmunition(ammunition.payload)); }
    else sourceErrors.push({ source: "Ammunition", error: ammunition.error || "Unavailable" });

    if (firearms.ok) { successful.add("Inspection"); generated.push(...collectInspections(firearms.payload, context)); }
    else sourceErrors.push({ source: "Inspection", error: firearms.error || "Unavailable" });

    if (range.ok) { successful.add("Range"); generated.push(...collectRange(range.payload, context)); }
    else sourceErrors.push({ source: "Range", error: range.error || "Unavailable" });

    if (range.ok && personnel.ok && rules.ok) {
      successful.add("Qualifications");
      generated.push(
        ...collectQualificationReadiness(
          range.payload,
          personnel.payload,
          rules.payload,
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
          "Unavailable",
      });
    }

    if (training.ok) { successful.add("Training"); generated.push(...training.items); }
    else sourceErrors.push({ source: "Training", error: training.error || "Unavailable" });


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
    const filtered = preferences.in_app_enabled
      ? generated.filter((item) => preferences.source_preferences[item.source] !== false)
      : [];

    const now = new Date().toISOString();
    const { data: existing, error: existingError } = await context.admin
      .from("notification_events")
      .select("*")
      .eq("department_id", context.departmentId)
      .eq("user_id", context.user.id);

    if (existingError) throw new Error(existingError.message);
    const byKey = new Map<string, ExistingNotificationEvent>(
      (existing ?? []).map(
        (row: ExistingNotificationEvent): [string, ExistingNotificationEvent] => [
          String(row.notification_key),
          row,
        ],
      ),
    );

    for (const item of filtered) {
      const prior = byKey.get(item.key);
      const fingerprint = JSON.stringify(item);
      const changed = prior && String(prior.fingerprint) !== fingerprint;

      const { error } = await context.admin.from("notification_events").upsert({
        department_id: context.departmentId,
        user_id: context.user.id,
        notification_key: item.key,
        source: item.source,
        kind: item.kind,
        title: item.title,
        detail: item.detail,
        href: item.href,
        priority: item.priority,
        fingerprint,
        source_created_at: item.createdAt || null,
        first_seen_at: prior?.first_seen_at ?? now,
        last_seen_at: now,
        resolved_at: null,
        acknowledged_at: changed ? null : prior?.acknowledged_at ?? null,
        snoozed_until: changed ? null : prior?.snoozed_until ?? null,
        updated_at: now,
      }, { onConflict: "department_id,user_id,notification_key" });

      if (error) throw new Error(error.message);

      if (preferences.email_enabled && (!preferences.critical_email_only || item.priority === "Critical") && context.user.email) {
        await context.admin.from("notification_email_queue").upsert({
          department_id: context.departmentId,
          user_id: context.user.id,
          recipient_email: context.user.email,
          notification_key: item.key,
          fingerprint,
          subject: `[TracePoint] ${item.title}`,
          body_text: `${item.title}\n\n${item.detail}\n\nOpen TracePoint: ${item.href}`,
          scheduled_for: now,
          status: "Pending",
          updated_at: now,
        }, { onConflict: "department_id,user_id,notification_key,fingerprint", ignoreDuplicates: true });
      }
    }

    const activeKeys = new Set(filtered.map((item) => item.key));
    for (const row of existing ?? []) {
      if (successful.has(String(row.source)) && !activeKeys.has(String(row.notification_key)) && !row.resolved_at) {
        await context.admin.from("notification_events").update({ resolved_at: now, updated_at: now }).eq("id", row.id);
      }
    }

    const { data: rows, error: rowsError } = await context.admin
      .from("notification_events")
      .select("*")
      .eq("department_id", context.departmentId)
      .eq("user_id", context.user.id)
      .is("resolved_at", null)
      .order("last_seen_at", { ascending: false });

    if (rowsError) throw new Error(rowsError.message);

    const allOpenItems = (rows ?? []).map((row: any) => ({
      id: row.id,
      notificationKey: row.notification_key,
      title: row.title,
      detail: row.detail,
      href: row.href,
      priority: row.priority,
      source: row.source,
      kind: row.kind,
      createdAt: row.source_created_at,
      acknowledgedAt: row.acknowledged_at,
      snoozedUntil: row.snoozed_until,
      lastSeenAt: row.last_seen_at,
    }));

    const visible = allOpenItems.filter((item: any) => {
      if (item.acknowledgedAt) return false;
      if (!item.snoozedUntil) return true;
      return new Date(item.snoozedUntil).getTime() <= Date.now();
    });

    const items = sortRows(visible);

    return NextResponse.json({
      items,
      allOpenItems: sortRows(allOpenItems),
      preferences,
      sourceErrors,
      counts: {
        open: items.length,
        critical: items.filter((item: any) => item.priority === "Critical").length,
        high: items.filter((item: any) => item.priority === "High").length,
        normal: items.filter((item: any) => item.priority === "Normal").length,
        acknowledged: allOpenItems.filter((item: any) => item.acknowledgedAt).length,
        snoozed: allOpenItems.filter((item: any) => item.snoozedUntil && new Date(item.snoozedUntil).getTime() > Date.now()).length,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Notifications could not be generated." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const context = await getContext();
  if ("error" in context) return NextResponse.json({ error: context.error }, { status: context.status });

  const body = await request.json().catch(() => ({})) as any;
  const action = text(body.action);
  const id = text(body.notificationId);
  if (!id || !["acknowledge", "reopen", "snooze", "unsnooze"].includes(action)) {
    return NextResponse.json({ error: "A valid action and notification ID are required." }, { status: 400 });
  }

  const { data: notification, error: notificationError } = await context.admin
    .from("notification_events")
    .select("id,kind")
    .eq("id", id)
    .eq("department_id", context.departmentId)
    .eq("user_id", context.user.id)
    .maybeSingle();

  if (notificationError) {
    return NextResponse.json(
      { error: notificationError.message },
      { status: 500 },
    );
  }

  if (!notification) {
    return NextResponse.json(
      { error: "Notification was not found." },
      { status: 404 },
    );
  }

  if (
    action === "acknowledge" &&
    CONDITION_BASED_NOTIFICATION_KINDS.has(String(notification.kind))
  ) {
    return NextResponse.json(
      {
        error:
          "This readiness alert remains open until the underlying condition is resolved. You may snooze it temporarily.",
      },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const patch = action === "acknowledge"
    ? { acknowledged_at: now, updated_at: now }
    : action === "reopen"
      ? { acknowledged_at: null, snoozed_until: null, updated_at: now }
      : action === "snooze"
        ? { snoozed_until: body.snoozedUntil || new Date(Date.now() + 86400000).toISOString(), updated_at: now }
        : { snoozed_until: null, updated_at: now };

  const { error } = await context.admin
    .from("notification_events")
    .update(patch)
    .eq("id", id)
    .eq("department_id", context.departmentId)
    .eq("user_id", context.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}





