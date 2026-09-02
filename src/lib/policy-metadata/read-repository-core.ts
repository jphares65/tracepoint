export type PolicyResult = { data: unknown; error: { message: string } | null };
export interface PolicyReadDataSource { listCertificationCapabilities(id: string): PromiseLike<PolicyResult>; getOffDutyRules(id: string): PromiseLike<PolicyResult>; }
export class PolicyReadAuthorizationError extends Error {}
export class PolicyReadRepositoryError extends Error {}
export function requirePolicyReadProvider(value?: string) { const provider = value?.trim().toLowerCase() || "supabase"; if (provider !== "supabase") throw new Error(`Unsupported data provider: ${provider}. Only supabase is implemented.`); }
export class TenantBoundPolicyReadRepository {
  private readonly source: PolicyReadDataSource; private readonly id: string;
  constructor(source: PolicyReadDataSource, id: string) { if (!id) throw new PolicyReadAuthorizationError(); this.source = source; this.id = id; }
  private authorize(id: string) { if (!id || id !== this.id) throw new PolicyReadAuthorizationError(); }
  private required(result: PolicyResult) { if (result.error) throw new PolicyReadRepositoryError(result.error.message); return result.data; }
  async listCertificationCapabilities(id: string) { this.authorize(id); const data = this.required(await this.source.listCertificationCapabilities(id)); return Array.isArray(data) ? data : []; }
  async getOffDutyRules(id: string) { this.authorize(id); const data = this.required(await this.source.getOffDutyRules(id)); return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null; }
}
