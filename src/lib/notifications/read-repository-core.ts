export type NotificationRow = Record<string, unknown>;
export type NotificationReadResult = { data: unknown; error: { message: string } | null };
export interface NotificationReadDataSource {
  listMemberships(departmentId: string, userId?: string): PromiseLike<NotificationReadResult>;
  listCredentials(departmentId: string, userId?: string): PromiseLike<NotificationReadResult>;
  listCertificationTypes(departmentId: string): PromiseLike<NotificationReadResult>;
  listCertificationRequirements(departmentId: string): PromiseLike<NotificationReadResult>;
  listProfiles(userIds: string[]): PromiseLike<NotificationReadResult>;
  getPreferences(departmentId: string, userId: string, includeUpdatedAt: boolean): PromiseLike<NotificationReadResult>;
  listQualificationResults(departmentId: string): PromiseLike<NotificationReadResult>;
  listNotificationEvents(departmentId: string, userId: string, openOnly: boolean): PromiseLike<NotificationReadResult>;
}
export class NotificationReadAuthorizationError extends Error { constructor() { super("Authorized department and user context is required."); this.name = "NotificationReadAuthorizationError"; } }
export class NotificationReadRepositoryError extends Error { constructor(message: string) { super(message); this.name = "NotificationReadRepositoryError"; } }
export function requireNotificationReadProvider(value?: string) { const provider = value?.trim().toLowerCase() || "supabase"; if (provider !== "supabase") throw new Error(`Unsupported data provider: ${provider}. Only supabase is implemented.`); return provider; }
const rows = (result: NotificationReadResult) => { if (result.error) throw new NotificationReadRepositoryError(result.error.message); return Array.isArray(result.data) ? result.data as NotificationRow[] : []; };
const record = (result: NotificationReadResult) => { if (result.error) throw new NotificationReadRepositoryError(result.error.message); return result.data && typeof result.data === "object" && !Array.isArray(result.data) ? result.data as NotificationRow : null; };
export class TenantBoundNotificationReadRepository {
  private readonly source: NotificationReadDataSource; private readonly departmentId: string; private readonly userId: string;
  constructor(source: NotificationReadDataSource, departmentId: string, userId: string) { if (!departmentId || !userId) throw new NotificationReadAuthorizationError(); this.source = source; this.departmentId = departmentId; this.userId = userId; }
  private authorize(departmentId: string, userId = this.userId) { if (departmentId !== this.departmentId || userId !== this.userId) throw new NotificationReadAuthorizationError(); }
  async getCertificationReadiness(departmentId: string, userId: string, departmentScope: boolean) { this.authorize(departmentId, userId); const scopedUser = departmentScope ? undefined : userId; const [memberships, types, requirements, credentials] = await Promise.all([this.source.listMemberships(departmentId, scopedUser), this.source.listCertificationTypes(departmentId), this.source.listCertificationRequirements(departmentId), this.source.listCredentials(departmentId, scopedUser)]); const memberRows = rows(memberships); const ids = memberRows.map((row) => String(row.user_id)); const profiles = ids.length ? rows(await this.source.listProfiles(ids)) : []; return { memberships: memberRows, certificationTypes: rows(types), requirements: rows(requirements), credentials: rows(credentials), profiles }; }
  async getPreferences(departmentId: string, userId: string, includeUpdatedAt = false) { this.authorize(departmentId, userId); return record(await this.source.getPreferences(departmentId, userId, includeUpdatedAt)); }
  async listQualificationResults(departmentId: string, userId: string) { this.authorize(departmentId, userId); return rows(await this.source.listQualificationResults(departmentId)); }
  async listNotificationEvents(departmentId: string, userId: string, openOnly = false) { this.authorize(departmentId, userId); return rows(await this.source.listNotificationEvents(departmentId, userId, openOnly)); }
}
