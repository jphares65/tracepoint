export type SettingsRow = Record<string, unknown>;
export type SettingsResult<T> = { data: T | null; error: { message?: unknown } | null };

export type SettingsMemberRow = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  badge_number: string | null;
  rank_title: string | null;
  unit_name: string | null;
  employee_number: string | null;
  is_active: boolean;
  joined_at: string | null;
  activation_status: string | null;
  role_codes: string[];
  effective_permissions: string[];
};

export interface SettingsOverviewDataSource {
  getDepartment(departmentId: string): PromiseLike<SettingsResult<SettingsRow>>;
  getRules(departmentId: string): PromiseLike<SettingsResult<SettingsRow>>;
  getSecurity(departmentId: string): PromiseLike<SettingsResult<SettingsRow>>;
  listRoles(): PromiseLike<SettingsResult<SettingsRow[]>>;
  listPermissions(): PromiseLike<SettingsResult<SettingsRow[]>>;
  listRolePermissions(departmentId: string): PromiseLike<SettingsResult<SettingsRow[]>>;
  listMemberships(departmentId: string): PromiseLike<SettingsResult<SettingsRow[]>>;
  listMembershipRoles(departmentId: string): PromiseLike<SettingsResult<SettingsRow[]>>;
  listDepartmentRolePermissions(departmentId: string): PromiseLike<SettingsResult<SettingsRow[]>>;
  listProfiles(userIds: string[]): PromiseLike<SettingsResult<SettingsRow[]>>;
}

export class SettingsOverviewAuthorizationError extends Error {
  constructor() { super("Authorized department context is required."); this.name = "SettingsOverviewAuthorizationError"; }
}
export class SettingsOverviewRepositoryError extends Error {
  constructor(message = "Settings could not be loaded.") { super(message); this.name = "SettingsOverviewRepositoryError"; }
}
export class SettingsOverviewRepositoryConfigurationError extends Error {
  constructor(provider: string) { super(`Unsupported data provider: ${provider}. Only supabase is implemented.`); this.name = "SettingsOverviewRepositoryConfigurationError"; }
}

export function requireSettingsOverviewProvider(provider: string | undefined) {
  const normalized = provider?.trim().toLowerCase() || "supabase";
  if (normalized !== "supabase") throw new SettingsOverviewRepositoryConfigurationError(normalized);
  return normalized;
}

function providerMessage(error: { message?: unknown } | null) {
  return typeof error?.message === "string" ? error.message : "Settings could not be loaded.";
}

function supportMembers(
  memberships: SettingsRow[],
  membershipRoles: SettingsRow[],
  rolePermissions: SettingsRow[],
  profiles: SettingsRow[],
): SettingsMemberRow[] {
  const profileById = new Map(profiles.map((profile) => [String(profile.id), profile]));
  const rolesByUser = new Map<string, Set<string>>();
  for (const row of membershipRoles) {
    if (!row.user_id || !row.role_code) continue;
    const userId = String(row.user_id);
    const roleCode = String(row.role_code);
    const roles = rolesByUser.get(userId) ?? new Set<string>();
    roles.add(roleCode); rolesByUser.set(userId, roles);
  }
  const permissionsByRole = new Map<string, Set<string>>();
  for (const row of rolePermissions) {
    if (!row.role_code || !row.permission_code) continue;
    const roleCode = String(row.role_code);
    const permissions = permissionsByRole.get(roleCode) ?? new Set<string>();
    permissions.add(String(row.permission_code)); permissionsByRole.set(roleCode, permissions);
  }
  const members = memberships.map((membership) => {
    const profile = profileById.get(String(membership.user_id));
    const userId = String(membership.user_id);
    const roleCodes = Array.from(rolesByUser.get(userId) ?? []).sort();
    return {
      user_id: userId,
      full_name: typeof profile?.full_name === "string" ? profile.full_name : null,
      email: typeof profile?.email === "string" ? profile.email : null,
      badge_number: membership.badge_number ?? null,
      rank_title: membership.rank_title ?? null,
      unit_name: membership.unit_name ?? null,
      employee_number: membership.employee_number ?? null,
      is_active: Boolean(membership.is_active),
      joined_at: membership.joined_at ?? null,
      activation_status: membership.activation_status ?? null,
      role_codes: roleCodes,
      effective_permissions: Array.from(new Set(roleCodes.flatMap((role) => Array.from(permissionsByRole.get(role) ?? [])))).sort(),
    } as SettingsMemberRow;
  });
  members.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
  return members;
}

export class TenantBoundSettingsOverviewRepository {
  private readonly source: SettingsOverviewDataSource;
  private readonly authorizedDepartmentId: string;
  constructor(source: SettingsOverviewDataSource, authorizedDepartmentId: string) {
    if (!authorizedDepartmentId) throw new SettingsOverviewAuthorizationError();
    this.source = source;
    this.authorizedDepartmentId = authorizedDepartmentId;
  }
  private requireDepartment(departmentId: string) {
    if (!departmentId || departmentId !== this.authorizedDepartmentId) throw new SettingsOverviewAuthorizationError();
  }
  async getOverview(input: { departmentId: string; canViewSecurity: boolean; includeSupportMembers: boolean }) {
    this.requireDepartment(input.departmentId);
    const [department, rules, security, roles, permissions, rolePermissions] = await Promise.all([
      this.source.getDepartment(input.departmentId), this.source.getRules(input.departmentId),
      input.canViewSecurity ? this.source.getSecurity(input.departmentId) : Promise.resolve({ data: null, error: null }),
      this.source.listRoles(), this.source.listPermissions(), this.source.listRolePermissions(input.departmentId),
    ]);
    const firstError = [department.error, rules.error, security.error, roles.error, permissions.error, rolePermissions.error].find(Boolean) ?? null;
    if (firstError) throw new SettingsOverviewRepositoryError(providerMessage(firstError));
    let members: SettingsMemberRow[] = [];
    if (input.includeSupportMembers) {
      const [memberships, memberRoles, memberPermissions] = await Promise.all([
        this.source.listMemberships(input.departmentId), this.source.listMembershipRoles(input.departmentId),
        this.source.listDepartmentRolePermissions(input.departmentId),
      ]);
      const supportError = [memberships.error, memberRoles.error, memberPermissions.error].find(Boolean) ?? null;
      if (supportError) throw new SettingsOverviewRepositoryError(providerMessage(supportError));
      const membershipRows = memberships.data ?? [];
      const userIds = membershipRows.map((row) => row.user_id).filter(Boolean).map(String);
      const profiles = userIds.length ? await this.source.listProfiles(userIds) : { data: [], error: null };
      if (profiles.error) throw new SettingsOverviewRepositoryError(providerMessage(profiles.error));
      members = supportMembers(membershipRows, memberRoles.data ?? [], memberPermissions.data ?? [], profiles.data ?? []);
    }
    return { department: department.data, rules: rules.data, security: security.data, roles: roles.data ?? [], permissions: permissions.data ?? [], rolePermissions: rolePermissions.data ?? [], members };
  }
}
