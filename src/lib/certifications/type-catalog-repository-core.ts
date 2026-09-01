export type CertificationTypeRow = Record<string, unknown>;
type QueryResult = { data: CertificationTypeRow[] | null; error: { message: string } | null };
type NameOrder = { order(column: string): PromiseLike<QueryResult> };
type CategoryOrder = { order(column: string): NameOrder };
export type CertificationTypeCatalogSupabaseClient = { from(table: "certification_types"): { select(fields: "*"): { eq(column: string, value: string): CategoryOrder } } };
export interface CertificationTypeCatalogRepository { listTypes(input: { departmentId: string }): Promise<CertificationTypeRow[]>; }
export class CertificationTypeCatalogAuthorizationError extends Error { constructor() { super("Authorized department context is required."); this.name = "CertificationTypeCatalogAuthorizationError"; } }
export class CertificationTypeCatalogRepositoryError extends Error { constructor() { super("Certification types could not be loaded."); this.name = "CertificationTypeCatalogRepositoryError"; } }
export class CertificationTypeCatalogRepositoryConfigurationError extends Error { constructor(provider: string) { super(`Unsupported data provider: ${provider}. Only supabase is implemented.`); this.name = "CertificationTypeCatalogRepositoryConfigurationError"; } }
export class SupabaseCertificationTypeCatalogRepository implements CertificationTypeCatalogRepository {
  private readonly client: CertificationTypeCatalogSupabaseClient;
  private readonly authorizedDepartmentId: string;
  constructor(client: CertificationTypeCatalogSupabaseClient, authorizedDepartmentId: string) { if (!authorizedDepartmentId) throw new CertificationTypeCatalogAuthorizationError(); this.client = client; this.authorizedDepartmentId = authorizedDepartmentId; }
  async listTypes(input: { departmentId: string }) { if (!input.departmentId || input.departmentId !== this.authorizedDepartmentId) throw new CertificationTypeCatalogAuthorizationError(); const result = await this.client.from("certification_types").select("*").eq("department_id", input.departmentId).order("category").order("name"); if (result.error) throw new CertificationTypeCatalogRepositoryError(); return result.data ?? []; }
}
export function createCertificationTypeCatalogRepository(client: CertificationTypeCatalogSupabaseClient, departmentId: string, environment?: { TRACEPOINT_DATA_PROVIDER?: string }) { const provider = (environment ? environment.TRACEPOINT_DATA_PROVIDER : process.env.TRACEPOINT_DATA_PROVIDER)?.trim().toLowerCase() || "supabase"; if (provider !== "supabase") throw new CertificationTypeCatalogRepositoryConfigurationError(provider); return new SupabaseCertificationTypeCatalogRepository(client, departmentId); }
