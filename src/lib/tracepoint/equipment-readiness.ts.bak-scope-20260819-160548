export type EquipmentReadinessStatus =
  | "current"
  | "due_soon"
  | "expired"
  | "inspection_due_soon"
  | "inspection_overdue"
  | "missing"
  | "out_of_service";

export type EquipmentReadinessMember = {
  userId: string;
  fullName: string;
  badgeNumber?: string | null;
  rankTitle?: string | null;
};

export type EquipmentReadinessType = {
  id: string;
  name: string;
  category: string;
  expirationRequired: boolean;
  defaultValidDays: number | null;
  defaultDueSoonDays: number;
  inspectionRequired: boolean;
  defaultInspectionIntervalDays: number | null;
  defaultInspectionDueSoonDays: number;
};

export type EquipmentReadinessRequirement = {
  equipmentTypeId: string;
  isRequired: boolean;
  isActive: boolean;
  requiredQuantity: number;
  validDays: number | null;
  dueSoonDays: number | null;
  inspectionIntervalDays: number | null;
  inspectionDueSoonDays: number | null;
};

export type EquipmentReadinessAsset = {
  id: string;
  userId: string | null;
  equipmentTypeId: string;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  lotNumber?: string | null;
  issueDate: string | null;
  expirationDate: string | null;
  lastInspectionDate: string | null;
  nextInspectionDate: string | null;
  lifecycleStatus: "active" | "out_of_service" | "removed";
};

export type EquipmentReadinessAssetEvaluation = {
  assetId: string;
  status: EquipmentReadinessStatus;
  expirationDate: string | null;
  expirationDaysRemaining: number | null;
  nextInspectionDate: string | null;
  inspectionDaysRemaining: number | null;
  reason: string;
};

export type EquipmentReadinessRow = {
  userId: string;
  officerName: string;
  badgeNumber?: string | null;
  rankTitle?: string | null;

  equipmentTypeId: string;
  equipmentName: string;
  equipmentCategory: string;

  requiredQuantity: number;
  assignedQuantity: number;
  readyQuantity: number;

  status: EquipmentReadinessStatus;
  statusReason: string;

  assets: EquipmentReadinessAssetEvaluation[];
};

export type EquipmentReadinessSummary = {
  totalRequiredChecks: number;
  current: number;
  dueSoon: number;
  expired: number;
  inspectionDueSoon: number;
  inspectionOverdue: number;
  missing: number;
  outOfService: number;
  ready: number;
  notReady: number;
  readinessPercent: number;
};

type EvaluatedAsset = EquipmentReadinessAssetEvaluation & {
  readinessRank: number;
  isReady: boolean;
};

const DAY_MS = 86_400_000;

function utcDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function todayUtc() {
  const now = new Date();

  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    ),
  );
}

function addDays(value: string, days: number) {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function daysRemaining(value: string, today: Date) {
  return Math.floor(
    (utcDate(value).getTime() - today.getTime()) / DAY_MS,
  );
}

function evaluateAsset(params: {
  asset: EquipmentReadinessAsset;
  type: EquipmentReadinessType;
  requirement: EquipmentReadinessRequirement;
  today: Date;
}): EvaluatedAsset {
  const { asset, type, requirement, today } = params;

  if (asset.lifecycleStatus === "out_of_service") {
    return {
      assetId: asset.id,
      status: "out_of_service",
      expirationDate: asset.expirationDate,
      expirationDaysRemaining: asset.expirationDate
        ? daysRemaining(asset.expirationDate, today)
        : null,
      nextInspectionDate: asset.nextInspectionDate,
      inspectionDaysRemaining: asset.nextInspectionDate
        ? daysRemaining(asset.nextInspectionDate, today)
        : null,
      reason: "Equipment is marked out of service.",
      readinessRank: 60,
      isReady: false,
    };
  }

  const validDays =
    requirement.validDays ??
    type.defaultValidDays ??
    null;

  const dueSoonDays =
    requirement.dueSoonDays ??
    type.defaultDueSoonDays;

  const inspectionIntervalDays =
    requirement.inspectionIntervalDays ??
    type.defaultInspectionIntervalDays ??
    null;

  const inspectionDueSoonDays =
    requirement.inspectionDueSoonDays ??
    type.defaultInspectionDueSoonDays;

  const effectiveExpiration =
    asset.expirationDate ??
    (
      asset.issueDate && validDays
        ? addDays(asset.issueDate, validDays)
        : null
    );

  let expirationRemaining: number | null = null;

  if (effectiveExpiration) {
    expirationRemaining =
      daysRemaining(effectiveExpiration, today);

    if (expirationRemaining < 0) {
      return {
        assetId: asset.id,
        status: "expired",
        expirationDate: effectiveExpiration,
        expirationDaysRemaining: expirationRemaining,
        nextInspectionDate: asset.nextInspectionDate,
        inspectionDaysRemaining: null,
        reason: `Equipment expired ${Math.abs(expirationRemaining)} day${
          Math.abs(expirationRemaining) === 1 ? "" : "s"
        } ago.`,
        readinessRank: 70,
        isReady: false,
      };
    }
  } else if (type.expirationRequired) {
    return {
      assetId: asset.id,
      status: "expired",
      expirationDate: null,
      expirationDaysRemaining: null,
      nextInspectionDate: asset.nextInspectionDate,
      inspectionDaysRemaining: null,
      reason:
        "Expiration is required but no expiration date can be determined.",
      readinessRank: 70,
      isReady: false,
    };
  }

  const effectiveInspectionDate =
    asset.nextInspectionDate ??
    (
      asset.lastInspectionDate && inspectionIntervalDays
        ? addDays(
            asset.lastInspectionDate,
            inspectionIntervalDays,
          )
        : null
    );

  let inspectionRemaining: number | null = null;

  if (effectiveInspectionDate) {
    inspectionRemaining =
      daysRemaining(effectiveInspectionDate, today);

    if (inspectionRemaining < 0) {
      return {
        assetId: asset.id,
        status: "inspection_overdue",
        expirationDate: effectiveExpiration,
        expirationDaysRemaining: expirationRemaining,
        nextInspectionDate: effectiveInspectionDate,
        inspectionDaysRemaining: inspectionRemaining,
        reason: `Equipment inspection is overdue by ${Math.abs(
          inspectionRemaining,
        )} day${
          Math.abs(inspectionRemaining) === 1 ? "" : "s"
        }.`,
        readinessRank: 80,
        isReady: false,
      };
    }
  } else if (type.inspectionRequired) {
    return {
      assetId: asset.id,
      status: "inspection_overdue",
      expirationDate: effectiveExpiration,
      expirationDaysRemaining: expirationRemaining,
      nextInspectionDate: null,
      inspectionDaysRemaining: null,
      reason:
        "Inspection is required but no current inspection due date can be determined.",
      readinessRank: 80,
      isReady: false,
    };
  }

  const expirationDueSoon =
    expirationRemaining !== null &&
    expirationRemaining <= dueSoonDays;

  const inspectionDueSoon =
    inspectionRemaining !== null &&
    inspectionRemaining <= inspectionDueSoonDays;

  if (expirationDueSoon) {
    return {
      assetId: asset.id,
      status: "due_soon",
      expirationDate: effectiveExpiration,
      expirationDaysRemaining: expirationRemaining,
      nextInspectionDate: effectiveInspectionDate,
      inspectionDaysRemaining: inspectionRemaining,
      reason: `Equipment expires in ${expirationRemaining} day${
        expirationRemaining === 1 ? "" : "s"
      }.`,
      readinessRank: 20,
      isReady: true,
    };
  }

  if (inspectionDueSoon) {
    return {
      assetId: asset.id,
      status: "inspection_due_soon",
      expirationDate: effectiveExpiration,
      expirationDaysRemaining: expirationRemaining,
      nextInspectionDate: effectiveInspectionDate,
      inspectionDaysRemaining: inspectionRemaining,
      reason: `Equipment inspection is due in ${inspectionRemaining} day${
        inspectionRemaining === 1 ? "" : "s"
      }.`,
      readinessRank: 30,
      isReady: true,
    };
  }

  return {
    assetId: asset.id,
    status: "current",
    expirationDate: effectiveExpiration,
    expirationDaysRemaining: expirationRemaining,
    nextInspectionDate: effectiveInspectionDate,
    inspectionDaysRemaining: inspectionRemaining,
    reason: "Equipment is current.",
    readinessRank: 10,
    isReady: true,
  };
}

function rowStatusFromSelected(
  selected: EvaluatedAsset[],
): {
  status: EquipmentReadinessStatus;
  reason: string;
} {
  const bad = selected.find(
    (asset) => !asset.isReady,
  );

  if (bad) {
    return {
      status: bad.status,
      reason: bad.reason,
    };
  }

  const dueSoon = selected.find(
    (asset) => asset.status === "due_soon",
  );

  if (dueSoon) {
    return {
      status: "due_soon",
      reason: dueSoon.reason,
    };
  }

  const inspectionDueSoon = selected.find(
    (asset) =>
      asset.status === "inspection_due_soon",
  );

  if (inspectionDueSoon) {
    return {
      status: "inspection_due_soon",
      reason: inspectionDueSoon.reason,
    };
  }

  return {
    status: "current",
    reason: "Required equipment is assigned and current.",
  };
}

export function evaluateEquipmentReadiness(params: {
  members: EquipmentReadinessMember[];
  equipmentTypes: EquipmentReadinessType[];
  requirements: EquipmentReadinessRequirement[];
  assets: EquipmentReadinessAsset[];
  today?: Date;
}): EquipmentReadinessRow[] {
  const {
    members,
    equipmentTypes,
    requirements,
    assets,
  } = params;

  const today = params.today ?? todayUtc();

  const typeMap = new Map(
    equipmentTypes.map((type) => [type.id, type]),
  );

  const required = requirements.filter(
    (requirement) =>
      requirement.isActive &&
      requirement.isRequired,
  );

  const rows: EquipmentReadinessRow[] = [];

  for (const member of members) {
    for (const requirement of required) {
      const type = typeMap.get(
        requirement.equipmentTypeId,
      );

      if (!type) continue;

      const requiredQuantity = Math.max(
        1,
        requirement.requiredQuantity || 1,
      );

      const assignedAssets = assets.filter(
        (asset) =>
          asset.userId === member.userId &&
          asset.equipmentTypeId === type.id &&
          asset.lifecycleStatus !== "removed",
      );

      const evaluated = assignedAssets
        .map((asset) =>
          evaluateAsset({
            asset,
            type,
            requirement,
            today,
          }),
        )
        .sort(
          (a, b) =>
            a.readinessRank - b.readinessRank,
        );

      const readyQuantity = evaluated.filter(
        (asset) => asset.isReady,
      ).length;

      let status: EquipmentReadinessStatus;
      let statusReason: string;

      if (assignedAssets.length < requiredQuantity) {
        status = "missing";

        const missingCount =
          requiredQuantity - assignedAssets.length;

        statusReason = `${missingCount} required ${type.name} item${
          missingCount === 1 ? " is" : "s are"
        } not assigned.`;
      } else {
        const selected = evaluated.slice(
          0,
          requiredQuantity,
        );

        const selectedStatus =
          rowStatusFromSelected(selected);

        status = selectedStatus.status;
        statusReason = selectedStatus.reason;
      }

      rows.push({
        userId: member.userId,
        officerName: member.fullName,
        badgeNumber: member.badgeNumber ?? null,
        rankTitle: member.rankTitle ?? null,

        equipmentTypeId: type.id,
        equipmentName: type.name,
        equipmentCategory: type.category,

        requiredQuantity,
        assignedQuantity: assignedAssets.length,
        readyQuantity,

        status,
        statusReason,

        assets: evaluated.map(
          ({
            readinessRank: _readinessRank,
            isReady: _isReady,
            ...asset
          }) => asset,
        ),
      });
    }
  }

  return rows;
}

export function summarizeEquipmentReadiness(
  rows: EquipmentReadinessRow[],
): EquipmentReadinessSummary {
  const summary: EquipmentReadinessSummary = {
    totalRequiredChecks: rows.length,
    current: 0,
    dueSoon: 0,
    expired: 0,
    inspectionDueSoon: 0,
    inspectionOverdue: 0,
    missing: 0,
    outOfService: 0,
    ready: 0,
    notReady: 0,
    readinessPercent: 100,
  };

  for (const row of rows) {
    switch (row.status) {
      case "current":
        summary.current += 1;
        summary.ready += 1;
        break;

      case "due_soon":
        summary.dueSoon += 1;
        summary.ready += 1;
        break;

      case "inspection_due_soon":
        summary.inspectionDueSoon += 1;
        summary.ready += 1;
        break;

      case "expired":
        summary.expired += 1;
        summary.notReady += 1;
        break;

      case "inspection_overdue":
        summary.inspectionOverdue += 1;
        summary.notReady += 1;
        break;

      case "missing":
        summary.missing += 1;
        summary.notReady += 1;
        break;

      case "out_of_service":
        summary.outOfService += 1;
        summary.notReady += 1;
        break;
    }
  }

  if (summary.totalRequiredChecks > 0) {
    summary.readinessPercent = Math.round(
      (summary.ready /
        summary.totalRequiredChecks) *
        100,
    );
  }

  return summary;
}
