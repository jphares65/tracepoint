export type TrainingRow = Record<string, unknown>;
export type TrainingResult = { data: unknown; error: { message: string } | null };
export interface TrainingReadDataSource {
  listCertifications(departmentId: string): PromiseLike<TrainingResult>;
  listMemberships(departmentId: string): PromiseLike<TrainingResult>;
  listTypes(departmentId: string): PromiseLike<TrainingResult>;
  listRequirements(departmentId: string, fields: string, order?: string): PromiseLike<TrainingResult>;
  listProfiles(userIds: string[]): PromiseLike<TrainingResult>;
}
export class TrainingReadAuthorizationError extends Error { constructor() { super("Authorized department context is required."); this.name = "TrainingReadAuthorizationError"; } }
export class TrainingReadRepositoryError extends Error { constructor(message: string) { super(message); this.name = "TrainingReadRepositoryError"; } }
export function requireTrainingReadProvider(provider: string | undefined) { const value = provider?.trim().toLowerCase() || "supabase"; if (value !== "supabase") throw new Error(`Unsupported data provider: ${value}. Only supabase is implemented.`); return value; }
const rows = (result: TrainingResult) => Array.isArray(result.data) ? result.data as TrainingRow[] : [];
export class TenantBoundTrainingReadRepository {
  private readonly source: TrainingReadDataSource;
  private readonly departmentId: string;
  constructor(source: TrainingReadDataSource, departmentId: string) { if (!departmentId) throw new TrainingReadAuthorizationError(); this.source = source; this.departmentId = departmentId; }
  private authorize(id: string) { if (!id || id !== this.departmentId) throw new TrainingReadAuthorizationError(); }
  private required(result: TrainingResult) { if (result.error) throw new TrainingReadRepositoryError(result.error.message); return rows(result); }
  async getCertificationWorkspace(departmentId: string) {
    this.authorize(departmentId);
    const results = await Promise.all([this.source.listCertifications(departmentId), this.source.listMemberships(departmentId), this.source.listTypes(departmentId), this.source.listRequirements(departmentId, "id,department_id,certification_type_id,is_required,valid_days,due_soon_days,is_active,notes")]);
    const certifications = this.required(results[0]); const memberships = this.required(results[1]); const certificationTypes = this.required(results[2]); const requirements = this.required(results[3]);
    const userIds = memberships.map((item) => String(item.user_id));
    const profiles = userIds.length ? this.required(await this.source.listProfiles(userIds)) : [];
    const profilesById = new Map(profiles.map((profile) => [String(profile.id), profile]));
    const members = memberships.map((membership) => { const profile = profilesById.get(String(membership.user_id)); return { user_id: String(membership.user_id), full_name: profile?.full_name || membership.rank_title || "Unnamed Officer", badge_number: membership.badge_number ?? null, rank_title: membership.rank_title ?? null, is_active: membership.is_active ?? true }; }).sort((left, right) => String(left.full_name).localeCompare(String(right.full_name)));
    return { certifications, members, certificationTypes, requirements };
  }
  async getRequirements(departmentId: string) { this.authorize(departmentId); return this.required(await this.source.listRequirements(departmentId, "*", "created_at")); }
}
