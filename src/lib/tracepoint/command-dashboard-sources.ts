import type { CommandDashboardCardKey } from "./analytics-dashboard-config.ts";

export type CommandDashboardSource =
  | "personnel"
  | "firearms"
  | "workspace"
  | "rules"
  | "certifications"
  | "equipment"
  | "performance";

// The data each summary card is computed from. A card whose source failed to
// load must show that, not an empty or "not configured" summary.
export const COMMAND_DASHBOARD_CARD_SOURCES: Partial<
  Record<CommandDashboardCardKey, readonly CommandDashboardSource[]>
> = {
  qualification_readiness: ["personnel", "performance"],
  certification_readiness: ["certifications"],
  equipment_readiness: ["equipment"],
  range_readiness: ["performance", "workspace"],
  records_health: ["performance", "workspace"],
  performance_signal: ["performance"],
  firearm_reliability: ["firearms", "workspace"],
};

// Features each endpoint itself requires (any one of them). An endpoint refused
// because its module is off for the agency has not failed to load.
const SOURCE_FEATURES: Record<CommandDashboardSource, readonly string[]> = {
  personnel: [],
  rules: [],
  certifications: [],
  firearms: ["firearms"],
  equipment: ["equipment_readiness"],
  workspace: ["range_training", "qualifications"],
  performance: ["range_training"],
};

export function dashboardLoadFailures(
  failed: ReadonlySet<CommandDashboardSource>,
  enabledFeatures: ReadonlySet<string>,
): ReadonlySet<CommandDashboardSource> {
  return new Set(
    [...failed].filter((source) => {
      const features = SOURCE_FEATURES[source];
      return features.length === 0 || features.some((feature) => enabledFeatures.has(feature));
    }),
  );
}

// Reads one dashboard response. A non-OK status or an unreadable body records
// the source as failed and returns null, so the caller keeps its fallback.
export async function readDashboardSource<T>(
  source: CommandDashboardSource,
  response: Pick<Response, "ok" | "json">,
  failed: Set<CommandDashboardSource>,
): Promise<T | null> {
  if (!response.ok) {
    failed.add(source);
    return null;
  }
  try {
    return (await response.json()) as T;
  } catch {
    failed.add(source);
    return null;
  }
}

export function cardLoadFailed(
  card: CommandDashboardCardKey,
  failed: ReadonlySet<CommandDashboardSource>,
) {
  return (COMMAND_DASHBOARD_CARD_SOURCES[card] ?? []).some((source) =>
    failed.has(source),
  );
}
