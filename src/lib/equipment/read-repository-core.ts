export type EquipmentRow = Record<string, unknown>;

export type EquipmentMemberRow = {
  user_id: unknown;
  badge_number?: unknown;
  rank_title?: unknown;
  unit_name?: unknown;
  deactivated_at?: unknown;
};

export type EquipmentProfileRow = {
  id: unknown;
  full_name?: unknown;
};

export type EquipmentMember = {
  userId: string;
  fullName: string;
  badgeNumber: unknown;
  rankTitle: unknown;
  unitName: unknown;
};

export type EquipmentInactiveHolder = EquipmentMember & { isActive: false; deactivatedAt: unknown };

export interface EquipmentReadDataSource {
  listTypes(departmentId: string): Promise<EquipmentRow[]>;
  listAssets(input: {
    departmentId: string;
    assignedUserId?: string;
  }): Promise<EquipmentRow[]>;
  listActiveMembers(departmentId: string): Promise<EquipmentMemberRow[]>;
  listInactiveMembers(departmentId: string, userIds: string[]): Promise<EquipmentMemberRow[]>;
  listProfiles(userIds: string[]): Promise<EquipmentProfileRow[]>;
  listRequirements(departmentId: string): Promise<EquipmentRow[]>;
}

export interface EquipmentReadRepository {
  listTypes(input: { departmentId: string }): Promise<EquipmentRow[]>;
  getAssetDirectory(input: {
    departmentId: string;
    userId: string;
    canViewDepartment: boolean;
  }): Promise<{ items: EquipmentRow[]; members: EquipmentMember[]; inactiveHolders: EquipmentInactiveHolder[] }>;
  listRequirements(input: { departmentId: string }): Promise<EquipmentRow[]>;
}

export class EquipmentReadAuthorizationError extends Error {
  constructor() {
    super("Authorized department context is required.");
    this.name = "EquipmentReadAuthorizationError";
  }
}

export class EquipmentReadRepositoryError extends Error {
  constructor(message = "Equipment data could not be loaded.") {
    super(message);
    this.name = "EquipmentReadRepositoryError";
  }
}

export class EquipmentReadRepositoryConfigurationError extends Error {
  constructor(provider: string) {
    super(`Unsupported data provider: ${provider}. Only supabase is implemented.`);
    this.name = "EquipmentReadRepositoryConfigurationError";
  }
}

export function requireEquipmentReadProvider(provider: string | undefined) {
  const normalized = provider?.trim().toLowerCase() || "supabase";
  if (normalized !== "supabase" && normalized !== "postgres") {
    throw new EquipmentReadRepositoryConfigurationError(normalized);
  }
  return normalized;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export class TenantBoundEquipmentReadRepository implements EquipmentReadRepository {
  private readonly source: EquipmentReadDataSource;
  private readonly authorizedDepartmentId: string;

  constructor(
    source: EquipmentReadDataSource,
    authorizedDepartmentId: string,
  ) {
    if (!authorizedDepartmentId) throw new EquipmentReadAuthorizationError();
    this.source = source;
    this.authorizedDepartmentId = authorizedDepartmentId;
  }

  private requireDepartment(departmentId: string) {
    if (!departmentId || departmentId !== this.authorizedDepartmentId) {
      throw new EquipmentReadAuthorizationError();
    }
  }

  async listTypes(input: { departmentId: string }) {
    this.requireDepartment(input.departmentId);
    return this.source.listTypes(input.departmentId);
  }

  async getAssetDirectory(input: {
    departmentId: string;
    userId: string;
    canViewDepartment: boolean;
  }) {
    this.requireDepartment(input.departmentId);
    if (!input.userId) throw new EquipmentReadAuthorizationError();

    const items = await this.source.listAssets({
      departmentId: input.departmentId,
      assignedUserId: input.canViewDepartment ? undefined : input.userId,
    });
    const memberRows = await this.source.listActiveMembers(input.departmentId);
    const userIds = memberRows.map((row) => String(row.user_id));
    // Holders whose membership is no longer active (separated officers).
    const activeIds = new Set(userIds);
    const holderIds = [...new Set(items
      .filter((item) => item.lifecycle_status !== "removed")
      .map((item) => text(item.assigned_user_id))
      .filter((id) => id && !activeIds.has(id)))];
    const inactiveRows = holderIds.length > 0
      ? await this.source.listInactiveMembers(input.departmentId, holderIds)
      : [];
    const profileIds = [...userIds, ...inactiveRows.map((row) => String(row.user_id))];
    const profiles = profileIds.length > 0 ? await this.source.listProfiles(profileIds) : [];
    const profileMap = new Map(
      profiles.map((row) => [String(row.id), row.full_name]),
    );
    const member = (row: EquipmentMemberRow) => ({
      userId: String(row.user_id),
      fullName:
        text(profileMap.get(String(row.user_id))) ||
        text(row.rank_title) ||
        "Unnamed Officer",
      badgeNumber: row.badge_number ?? null,
      rankTitle: row.rank_title ?? null,
      unitName: row.unit_name ?? null,
    });

    return {
      items,
      members: memberRows.map(member),
      inactiveHolders: inactiveRows.map((row) => ({
        ...member(row),
        isActive: false as const,
        deactivatedAt: row.deactivated_at ?? null,
      })),
    };
  }

  async listRequirements(input: { departmentId: string }) {
    this.requireDepartment(input.departmentId);
    return this.source.listRequirements(input.departmentId);
  }
}
