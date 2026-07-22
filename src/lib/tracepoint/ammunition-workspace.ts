"use client";

export type VerificationMode =
  | "Manual"
  | "Monthly"
  | "Quarterly"
  | "Semiannual"
  | "Annual"
  | "After Range Season"
  | "Custom Days";

export type AmmoType = {
  id: string;
  name: string;
  caliber: string;
  category: string;
  purpose: string;
  unitLabel: string;
  currentOnHand: number;
  reorderThreshold: number;
  verificationMode: VerificationMode;
  customIntervalDays: number | null;
  nextVerificationDate: string;
  notes: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AmmoLot = {
  id: string;
  ammoTypeId: string;
  manufacturer: string;
  product: string;
  lotNumber: string;
  vendor: string;
  purchaseDate: string;
  invoiceNumber: string;
  quantityReceived: number;
  quantityRemaining: number;
  costPerRound: number;
  shippingCost: number;
  taxCost: number;
  totalCost: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type AmmoActivityKind =
  | "Type Created"
  | "Purchase Received"
  | "Range Issue"
  | "Duty Issue"
  | "Return"
  | "Disposal"
  | "Correction"
  | "Physical Count";

export type AmmoActivity = {
  id: string;
  ammoTypeId: string;
  lotId: string | null;
  kind: AmmoActivityKind;
  quantityChange: number;
  quantityBefore: number;
  quantityAfter: number;
  reference: string;
  notes: string;
  unitCost: number | null;
  totalCost: number | null;
  createdAt: string;
};

export type AmmoReconciliation = {
  id: string;
  ammoTypeId: string;
  expectedQuantity: number;
  physicalQuantity: number;
  variance: number;
  notes: string;
  completedAt: string;
};

export type AmmoSettings = {
  defaultVerificationMode: VerificationMode;
  defaultCustomIntervalDays: number;
  allowNegativeInventory: boolean;
};

export type AmmoWorkspaceV2 = {
  schemaVersion: 2;
  ammoTypes: AmmoType[];
  lots: AmmoLot[];
  activity: AmmoActivity[];
  reconciliations: AmmoReconciliation[];
  settings: AmmoSettings;
  dutyLots?: unknown[];
  trainingLots?: unknown[];
  transactions?: unknown[];
};

type LegacyAmmoLot = {
  id?: string;
  caliber?: string;
  manufacturer?: string;
  loadDescription?: string;
  lotNumber?: string;
  purchaseDate?: string;
  quantityOnHand?: number;
  costPerRound?: number;
  lowStockThreshold?: number;
  replacementDueDate?: string;
  recallFlag?: boolean;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

type LegacyTransaction = {
  id?: string;
  workspace?: string;
  lotId?: string;
  description?: string;
  quantityChange?: number;
  createdAt?: string;
};

type LegacyWorkspace = {
  dutyLots?: LegacyAmmoLot[];
  trainingLots?: LegacyAmmoLot[];
  transactions?: LegacyTransaction[];
};

export const VERIFICATION_MODES: VerificationMode[] = [
  "Manual",
  "Monthly",
  "Quarterly",
  "Semiannual",
  "Annual",
  "After Range Season",
  "Custom Days",
];

export const EMPTY_AMMO_WORKSPACE: AmmoWorkspaceV2 = {
  schemaVersion: 2,
  ammoTypes: [],
  lots: [],
  activity: [],
  reconciliations: [],
  settings: {
    defaultVerificationMode: "After Range Season",
    defaultCustomIntervalDays: 180,
    allowNegativeInventory: false,
  },
};

export function createAmmoId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function asNonNegativeInteger(value: unknown) {
  const parsed =
    typeof value === "number"
      ? Math.trunc(value)
      : Number.parseInt(String(value ?? ""), 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function asMoney(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(String(value ?? ""));

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeDate(value: unknown, fallback: string) {
  const text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function safeIso(value: unknown, fallback: string) {
  const text = cleanText(value);
  const parsed = text ? new Date(text) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function asVerificationMode(value: unknown): VerificationMode {
  return VERIFICATION_MODES.includes(value as VerificationMode)
    ? (value as VerificationMode)
    : "After Range Season";
}

export function calculateNextVerificationDate(
  mode: VerificationMode,
  customIntervalDays: number | null,
  fromDate = new Date(),
) {
  if (mode === "Manual" || mode === "After Range Season") return "";

  const next = new Date(fromDate);
  const days =
    mode === "Monthly"
      ? 30
      : mode === "Quarterly"
        ? 90
        : mode === "Semiannual"
          ? 182
          : mode === "Annual"
            ? 365
            : Math.max(1, customIntervalDays ?? 180);

  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function normalizeV2(value: Partial<AmmoWorkspaceV2>): AmmoWorkspaceV2 {
  const now = new Date().toISOString();
  const settings = value.settings ?? EMPTY_AMMO_WORKSPACE.settings;

  return {
    schemaVersion: 2,
    ammoTypes: Array.isArray(value.ammoTypes)
      ? value.ammoTypes.map((item) => ({
          id: cleanText(item.id) || createAmmoId("ammo-type"),
          name: cleanText(item.name) || "Unnamed ammunition",
          caliber: cleanText(item.caliber),
          category: cleanText(item.category),
          purpose: cleanText(item.purpose),
          unitLabel: cleanText(item.unitLabel) || "rounds",
          currentOnHand: asNonNegativeInteger(item.currentOnHand),
          reorderThreshold: asNonNegativeInteger(item.reorderThreshold),
          verificationMode: asVerificationMode(item.verificationMode),
          customIntervalDays:
            item.customIntervalDays === null
              ? null
              : asNonNegativeInteger(item.customIntervalDays),
          nextVerificationDate: cleanText(item.nextVerificationDate),
          notes: cleanText(item.notes),
          isActive: item.isActive !== false,
          createdAt: safeIso(item.createdAt, now),
          updatedAt: safeIso(item.updatedAt, now),
        }))
      : [],
    lots: Array.isArray(value.lots)
      ? value.lots.map((item) => ({
          id: cleanText(item.id) || createAmmoId("ammo-lot"),
          ammoTypeId: cleanText(item.ammoTypeId),
          manufacturer: cleanText(item.manufacturer),
          product: cleanText(item.product),
          lotNumber: cleanText(item.lotNumber),
          vendor: cleanText(item.vendor),
          purchaseDate: cleanText(item.purchaseDate),
          invoiceNumber: cleanText(item.invoiceNumber),
          quantityReceived: asNonNegativeInteger(item.quantityReceived),
          quantityRemaining: asNonNegativeInteger(item.quantityRemaining),
          costPerRound: asMoney(item.costPerRound),
          shippingCost: asMoney(item.shippingCost),
          taxCost: asMoney(item.taxCost),
          totalCost: asMoney(item.totalCost),
          notes: cleanText(item.notes),
          createdAt: safeIso(item.createdAt, now),
          updatedAt: safeIso(item.updatedAt, now),
        }))
      : [],
    activity: Array.isArray(value.activity)
      ? value.activity.map((item) => ({
          id: cleanText(item.id) || createAmmoId("ammo-activity"),
          ammoTypeId: cleanText(item.ammoTypeId),
          lotId: cleanText(item.lotId) || null,
          kind: item.kind,
          quantityChange:
            typeof item.quantityChange === "number" ? item.quantityChange : 0,
          quantityBefore: asNonNegativeInteger(item.quantityBefore),
          quantityAfter: asNonNegativeInteger(item.quantityAfter),
          reference: cleanText(item.reference),
          notes: cleanText(item.notes),
          unitCost:
            item.unitCost === null || item.unitCost === undefined
              ? null
              : asMoney(item.unitCost),
          totalCost:
            item.totalCost === null || item.totalCost === undefined
              ? null
              : asMoney(item.totalCost),
          createdAt: safeIso(item.createdAt, now),
        }))
      : [],
    reconciliations: Array.isArray(value.reconciliations)
      ? value.reconciliations.map((item) => ({
          id: cleanText(item.id) || createAmmoId("ammo-count"),
          ammoTypeId: cleanText(item.ammoTypeId),
          expectedQuantity: asNonNegativeInteger(item.expectedQuantity),
          physicalQuantity: asNonNegativeInteger(item.physicalQuantity),
          variance:
            typeof item.variance === "number"
              ? Math.trunc(item.variance)
              : 0,
          notes: cleanText(item.notes),
          completedAt: safeIso(item.completedAt, now),
        }))
      : [],
    settings: {
      defaultVerificationMode: asVerificationMode(
        settings.defaultVerificationMode,
      ),
      defaultCustomIntervalDays: Math.max(
        1,
        asNonNegativeInteger(settings.defaultCustomIntervalDays) || 180,
      ),
      allowNegativeInventory: settings.allowNegativeInventory === true,
    },
    dutyLots: Array.isArray(value.dutyLots) ? value.dutyLots : [],
    trainingLots: Array.isArray(value.trainingLots) ? value.trainingLots : [],
    transactions: Array.isArray(value.transactions) ? value.transactions : [],
  };
}

function migrateLegacy(value: LegacyWorkspace): AmmoWorkspaceV2 {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const types: AmmoType[] = [];
  const lots: AmmoLot[] = [];
  const keyToTypeId = new Map<string, string>();

  const addLegacyLots = (
    source: LegacyAmmoLot[] | undefined,
    category: string,
    purpose: string,
  ) => {
    for (const legacy of source ?? []) {
      const caliber = cleanText(legacy.caliber) || "Unspecified";
      const key = `${category.toLowerCase()}::${caliber.toLowerCase()}`;
      let typeId = keyToTypeId.get(key);

      if (!typeId) {
        typeId = createAmmoId("ammo-type");
        keyToTypeId.set(key, typeId);
        types.push({
          id: typeId,
          name: `${caliber} ${category}`,
          caliber,
          category,
          purpose,
          unitLabel: "rounds",
          currentOnHand: 0,
          reorderThreshold: 0,
          verificationMode: "After Range Season",
          customIntervalDays: null,
          nextVerificationDate: "",
          notes: "Migrated from the original ammunition workspace.",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
      }

      const quantity = asNonNegativeInteger(legacy.quantityOnHand);
      const threshold = asNonNegativeInteger(legacy.lowStockThreshold);
      const type = types.find((item) => item.id === typeId);

      if (type) {
        type.currentOnHand += quantity;
        type.reorderThreshold = Math.max(type.reorderThreshold, threshold);
      }

      const costPerRound = asMoney(legacy.costPerRound);
      lots.push({
        id: cleanText(legacy.id) || createAmmoId("ammo-lot"),
        ammoTypeId: typeId,
        manufacturer: cleanText(legacy.manufacturer),
        product: cleanText(legacy.loadDescription),
        lotNumber: cleanText(legacy.lotNumber),
        vendor: "",
        purchaseDate: safeDate(legacy.purchaseDate, today),
        invoiceNumber: "",
        quantityReceived: quantity,
        quantityRemaining: quantity,
        costPerRound,
        shippingCost: 0,
        taxCost: 0,
        totalCost: costPerRound * quantity,
        notes: cleanText(legacy.notes),
        createdAt: safeIso(legacy.createdAt, now),
        updatedAt: safeIso(legacy.updatedAt, now),
      });
    }
  };

  addLegacyLots(value.dutyLots, "Duty", "Duty issue and replacement");
  addLegacyLots(value.trainingLots, "Training", "Range and qualification use");

  const legacyTransactions = Array.isArray(value.transactions)
    ? value.transactions
    : [];

  const activity: AmmoActivity[] = legacyTransactions.map((item) => {
    const matchingLot = lots.find((lot) => lot.id === cleanText(item.lotId));
    const type =
      matchingLot?.ammoTypeId ??
      types.find((candidate) =>
        candidate.category
          .toLowerCase()
          .includes(cleanText(item.workspace).toLowerCase()),
      )?.id ??
      types[0]?.id ??
      "";

    const quantityChange =
      typeof item.quantityChange === "number" ? item.quantityChange : 0;

    return {
      id: cleanText(item.id) || createAmmoId("ammo-activity"),
      ammoTypeId: type,
      lotId: matchingLot?.id ?? null,
      kind: quantityChange >= 0 ? "Purchase Received" : "Correction",
      quantityChange,
      quantityBefore: 0,
      quantityAfter: 0,
      reference: cleanText(item.workspace),
      notes: cleanText(item.description),
      unitCost: null,
      totalCost: null,
      createdAt: safeIso(item.createdAt, now),
    };
  });

  return withLegacyAmmunitionProjection({
    ...EMPTY_AMMO_WORKSPACE,
    ammoTypes: types,
    lots,
    activity,
  });
}

export function normalizeAmmoWorkspace(value: unknown): AmmoWorkspaceV2 {
  if (!value || typeof value !== "object") return EMPTY_AMMO_WORKSPACE;

  const candidate = value as Partial<AmmoWorkspaceV2> & LegacyWorkspace;

  if (
    candidate.schemaVersion === 2 ||
    Array.isArray(candidate.ammoTypes) ||
    Array.isArray(candidate.lots)
  ) {
    return normalizeV2(candidate);
  }

  return migrateLegacy(candidate);
}

export function getLotsForType(workspace: AmmoWorkspaceV2, ammoTypeId: string) {
  return workspace.lots.filter((lot) => lot.ammoTypeId === ammoTypeId);
}

export function getWeightedAverageCost(
  workspace: AmmoWorkspaceV2,
  ammoTypeId: string,
) {
  const lots = getLotsForType(workspace, ammoTypeId);
  const totalQuantity = lots.reduce(
    (sum, lot) => sum + lot.quantityReceived,
    0,
  );
  const totalCost = lots.reduce((sum, lot) => sum + lot.totalCost, 0);

  return totalQuantity > 0 ? totalCost / totalQuantity : 0;
}

export function getCurrentInventoryValue(
  workspace: AmmoWorkspaceV2,
  ammoTypeId: string,
) {
  const type = workspace.ammoTypes.find((item) => item.id === ammoTypeId);
  return type
    ? type.currentOnHand * getWeightedAverageCost(workspace, ammoTypeId)
    : 0;
}

export function getLastPhysicalCount(
  workspace: AmmoWorkspaceV2,
  ammoTypeId: string,
) {
  return [...workspace.reconciliations]
    .filter((item) => item.ammoTypeId === ammoTypeId)
    .sort(
      (left, right) =>
        new Date(right.completedAt).getTime() -
        new Date(left.completedAt).getTime(),
    )[0];
}

export function withLegacyAmmunitionProjection(
  workspace: AmmoWorkspaceV2,
): AmmoWorkspaceV2 {
  const trainingLots = workspace.ammoTypes
    .filter((type) => type.isActive)
    .map((type) => ({
      id: `type-summary-${type.id}`,
      caliber: type.name,
      manufacturer: "Standing Inventory",
      loadDescription: `${type.category}${type.purpose ? ` · ${type.purpose}` : ""}`,
      lotNumber: "TYPE-SUMMARY",
      purchaseDate: "",
      quantityOnHand: type.currentOnHand,
      costPerRound: getWeightedAverageCost(workspace, type.id),
      lowStockThreshold: type.reorderThreshold,
      notes:
        "Compatibility projection used by the centralized notification engine.",
      issuedToRangeDays: [],
      createdAt: type.createdAt,
      updatedAt: type.updatedAt,
      ammoTypeId: type.id,
      isTypeSummary: true,
    }));

  const dutyLots = workspace.lots.map((lot) => {
    const type = workspace.ammoTypes.find(
      (candidate) => candidate.id === lot.ammoTypeId,
    );

    return {
      id: lot.id,
      caliber: type?.caliber || type?.name || "Unspecified",
      manufacturer: lot.manufacturer,
      loadDescription: lot.product,
      lotNumber: lot.lotNumber,
      purchaseDate: lot.purchaseDate,
      quantityOnHand: lot.quantityRemaining,
      replacementDueDate: "",
      recallFlag: false,
      notes: lot.notes,
      issueHistory: [],
      createdAt: lot.createdAt,
      updatedAt: lot.updatedAt,
      ammoTypeId: lot.ammoTypeId,
    };
  });

  const transactions = workspace.activity.map((item) => ({
    id: item.id,
    workspace: "Training",
    lotId: item.lotId ?? `type-summary-${item.ammoTypeId}`,
    description: item.notes || item.kind,
    quantityChange: item.quantityChange,
    createdAt: item.createdAt,
    ammoTypeId: item.ammoTypeId,
  }));

  return {
    ...workspace,
    dutyLots,
    trainingLots,
    transactions,
  };
}
