export type ArmoryRow = Record<string, unknown>;
export type ArmoryResult = { data: ArmoryRow[] | null; error: { message: string } | null };
export type ArmoryUsersResult = { data: { users: ArmoryRow[] } | null; error: { message: string } | null };

export interface ArmoryReadDataSource {
  listActiveAssignments(departmentId: string, userId?: string): PromiseLike<ArmoryResult>;
  listFirearms(departmentId: string, input: { includeArchived: boolean; firearmIds?: string[] }): PromiseLike<ArmoryResult>;
  listActiveMembers(departmentId: string): PromiseLike<ArmoryResult>;
  listProfiles(userIds: string[]): PromiseLike<ArmoryResult>;
  listAuthUsers(): PromiseLike<ArmoryUsersResult>;
  listInspections(departmentId: string): PromiseLike<ArmoryResult>;
}

export class ArmoryReadAuthorizationError extends Error {
  constructor() { super("Authorized department and user context is required."); this.name = "ArmoryReadAuthorizationError"; }
}
export class ArmoryReadRepositoryError extends Error {
  constructor(message: string) { super(message); this.name = "ArmoryReadRepositoryError"; }
}
export class ArmoryReadConfigurationError extends Error {
  constructor(provider: string) { super(`Unsupported data provider: ${provider}. Only supabase is implemented.`); this.name = "ArmoryReadConfigurationError"; }
}
export function requireArmoryReadProvider(provider: string | undefined) {
  const value = provider?.trim().toLowerCase() || "supabase";
  if (value !== "supabase") throw new ArmoryReadConfigurationError(value);
  return value;
}

function rows(result: ArmoryResult) {
  if (result.error) throw new ArmoryReadRepositoryError(result.error.message);
  return result.data ?? [];
}
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function metadata(row: ArmoryRow | undefined) {
  return row?.user_metadata && typeof row.user_metadata === "object" ? row.user_metadata as ArmoryRow : {};
}

export class TenantBoundArmoryReadRepository {
  private readonly source: ArmoryReadDataSource;
  private readonly departmentId: string;
  private readonly userId: string;
  constructor(source: ArmoryReadDataSource, departmentId: string, userId: string) {
    if (!departmentId || !userId) throw new ArmoryReadAuthorizationError();
    this.source = source; this.departmentId = departmentId; this.userId = userId;
  }
  private authorize(departmentId: string, userId: string) {
    if (departmentId !== this.departmentId || userId !== this.userId) throw new ArmoryReadAuthorizationError();
  }

  async getFirearmInventory(input: { departmentId: string; userId: string; includeArchived: boolean; canViewAll: boolean; canManage: boolean; canInspect: boolean }) {
    this.authorize(input.departmentId, input.userId);
    const assignments = rows(await this.source.listActiveAssignments(input.departmentId, input.canViewAll ? undefined : input.userId));
    const firearmIds = [...new Set(assignments.map((row) => text(row.firearm_id)).filter(Boolean))];
    const firearms = input.canViewAll || firearmIds.length
      ? rows(await this.source.listFirearms(input.departmentId, { includeArchived: input.canViewAll && input.includeArchived, firearmIds: input.canViewAll ? undefined : firearmIds }))
      : [];
    const memberships = rows(await this.source.listActiveMembers(input.departmentId));
    const userIds = memberships.map((row) => text(row.user_id)).filter(Boolean);
    const profiles = userIds.length ? rows(await this.source.listProfiles(userIds)) : [];
    const usersResult = await this.source.listAuthUsers();
    if (usersResult.error) throw new ArmoryReadRepositoryError(usersResult.error.message);
    const profilesById = new Map(profiles.map((row) => [text(row.id), row]));
    const usersById = new Map((usersResult.data?.users ?? []).map((row) => [text(row.id), row]));
    const members = memberships.map((membership) => {
      const id = text(membership.user_id); const profile = profilesById.get(id); const user = usersById.get(id); const meta = metadata(user);
      return { user_id: id, full_name: text(profile?.full_name) || text(meta.full_name) || text(meta.name) || text(meta.display_name) || text(profile?.email) || text(user?.email) || "Unknown User", email: text(profile?.email) || text(user?.email), rank_title: membership.rank_title ?? null, badge_number: membership.badge_number ?? null };
    }).sort((left, right) => left.full_name.localeCompare(right.full_name));
    const membersById = new Map(members.map((member) => [member.user_id, member]));
    const assignmentsByFirearmId = new Map(assignments.map((assignment) => [text(assignment.firearm_id), { ...assignment, assigned_to_name: membersById.get(text(assignment.assigned_to_user_id))?.full_name ?? "Unknown User" }]));
    return { departmentId: input.departmentId, firearms: firearms.map((firearm) => ({ ...firearm, condition_status: firearm.condition_status ?? "In Service", active_assignment: assignmentsByFirearmId.get(text(firearm.id)) ?? null })), members: input.canManage ? members : [], access: { canViewAll: input.canViewAll, canManage: input.canManage, canInspect: input.canInspect } };
  }

  async listInspections(input: { departmentId: string; userId: string }) {
    this.authorize(input.departmentId, input.userId);
    return rows(await this.source.listInspections(input.departmentId));
  }
}
