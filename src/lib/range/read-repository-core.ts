export type RangeReadResult = { data: unknown; error: { message: string } | null };
export interface RangeReadDataSource {
  getRangeWorkspace(id: string): PromiseLike<RangeReadResult>;
  listStandards(id: string): PromiseLike<RangeReadResult>;
  listStandardComponents(id: string): PromiseLike<RangeReadResult>;
  listMemberships(id: string): PromiseLike<RangeReadResult>;
  listProfiles(ids: string[]): PromiseLike<RangeReadResult>;
  listRoles(id: string, ids: string[]): PromiseLike<RangeReadResult>;
  getAmmunitionWorkspace(id: string): PromiseLike<RangeReadResult>;
  getRemediationWorkspace(id: string): PromiseLike<RangeReadResult>;
  listQualificationResults(id: string): PromiseLike<RangeReadResult>;
  listRangeDays(id: string): PromiseLike<RangeReadResult>;
  listRangeDayDrills(id: string): PromiseLike<RangeReadResult>;
  listDrillResults(id: string): PromiseLike<RangeReadResult>;
  listRangeRoster(id: string): PromiseLike<RangeReadResult>;
}
export class RangeReadAuthorizationError extends Error {}
export class RangeReadRepositoryError extends Error {}
const rows = (result: RangeReadResult) => Array.isArray(result.data) ? result.data as Record<string, unknown>[] : [];
export function requireRangeReadProvider(value?: string) { const provider = value?.trim().toLowerCase() || "supabase"; if (provider !== "supabase") throw new Error(`Unsupported data provider: ${provider}. Only supabase is implemented.`); }
export class TenantBoundRangeReadRepository {
  private readonly source: RangeReadDataSource;
  private readonly departmentId: string;
  constructor(source: RangeReadDataSource, departmentId: string) { if (!departmentId) throw new RangeReadAuthorizationError("Authorized department context is required."); this.source = source; this.departmentId = departmentId; }
  private authorize(id: string) { if (!id || id !== this.departmentId) throw new RangeReadAuthorizationError("Authorized department context is required."); }
  private data(result: RangeReadResult) { if (result.error) throw new RangeReadRepositoryError(result.error.message); return result.data as Record<string, unknown> | null; }
  private list(result: RangeReadResult) { if (result.error) throw new RangeReadRepositoryError(result.error.message); return rows(result); }
  async getWorkspace(id: string) { this.authorize(id); const [workspace, standards, components] = await Promise.all([this.source.getRangeWorkspace(id), this.source.listStandards(id), this.source.listStandardComponents(id)]); const record = this.data(workspace); const componentRows = this.list(components); return { workspace: record?.workspace ?? null, updatedAt: record?.updated_at ?? null, updatedByUserId: record?.updated_by_user_id ?? null, qualificationStandards: this.list(standards).map((standard) => ({ id: standard.id, name: standard.name, firearmType: standard.firearm_type, components: componentRows.filter((component) => component.qualification_standard_id === standard.id).map((component) => ({ name: component.name, scoringBasis: component.scoring_basis, passingScore: component.passing_score, passingTimeSeconds: component.passing_time_seconds, minimumHits: component.minimum_hits, isRequired: component.is_required })) })) }; }
  async getPersonnel(id: string) { this.authorize(id); const memberships = this.list(await this.source.listMemberships(id)); const ids = memberships.map((row) => String(row.user_id)).filter(Boolean); const [profiles, roles] = ids.length ? await Promise.all([this.source.listProfiles(ids), this.source.listRoles(id, ids)]) : [{ data: [], error: null }, { data: [], error: null }]; return { memberships, profiles: this.list(profiles), roles: this.list(roles) }; }
  async getAmmunition(id: string) { this.authorize(id); return this.data(await this.source.getAmmunitionWorkspace(id)); }
  async getRemediations(id: string) { this.authorize(id); return this.data(await this.source.getRemediationWorkspace(id)); }
  async getPerformanceInputs(id: string) {
    this.authorize(id);
    const memberships = this.list(await this.source.listMemberships(id));
    const userIds = memberships.map((row) => String(row.user_id)).filter(Boolean);
    const [profilesResult, qualifications, rangeDays, drills, drillResults, roster] = await Promise.all([
      userIds.length ? this.source.listProfiles(userIds) : Promise.resolve({ data: [], error: null }),
      this.source.listQualificationResults(id), this.source.listRangeDays(id), this.source.listRangeDayDrills(id), this.source.listDrillResults(id), this.source.listRangeRoster(id),
    ]);
    const profiles = this.list(profilesResult);
    const profilesById = new Map(profiles.map((profile) => [String(profile.id), profile]));
    const personnelLabels = Object.fromEntries(memberships.map((membership) => {
      const profile = profilesById.get(String(membership.user_id));
      const fullName = String(profile?.full_name ?? profile?.email ?? membership.user_id).trim();
      const rank = String(membership.rank_title ?? "").trim();
      const name = rank && !fullName.toLowerCase().startsWith(`${rank.toLowerCase()} `) ? `${rank} ${fullName}` : fullName;
      return [String(membership.user_id), { name, assignment: String(membership.unit_name ?? "").trim() || "Department Personnel" }];
    }));
    return { personnelLabels, qualificationResults: this.list(qualifications), rangeDays: this.list(rangeDays), drills: this.list(drills), drillResults: this.list(drillResults), rangeRoster: this.list(roster) };
  }
}
