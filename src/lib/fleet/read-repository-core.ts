export type FleetRow = Record<string, unknown>;
export type FleetResult = { data: unknown; error: { message: string; code?: string } | null };
export interface FleetReadDataSource {
  getRules(departmentId: string, fields: string): PromiseLike<FleetResult>;
  listVehicles(departmentId: string, fields: string): PromiseLike<FleetResult>;
  getVehicle(departmentId: string, vehicleId: string): PromiseLike<FleetResult>;
  listWorkOrders(departmentId: string, vehicleId: string): PromiseLike<FleetResult>;
  listEquipment(departmentId: string, vehicleId: string): PromiseLike<FleetResult>;
  listDocuments(departmentId: string, vehicleId: string): PromiseLike<FleetResult>;
  listInspections(departmentId: string, vehicleId: string): PromiseLike<FleetResult>;
  listHistory(departmentId: string, vehicleId: string): PromiseLike<FleetResult>;
  listProfiles(userIds: string[]): PromiseLike<FleetResult>;
}
export class FleetReadAuthorizationError extends Error { constructor() { super("Authorized department context is required."); this.name = "FleetReadAuthorizationError"; } }
export class FleetReadRepositoryError extends Error { readonly code?: string; constructor(message: string, code?: string) { super(message); this.name = "FleetReadRepositoryError"; this.code = code; } }
export class FleetReadConfigurationError extends Error { constructor(provider: string) { super(`Unsupported data provider: ${provider}. Only supabase is implemented.`); this.name = "FleetReadConfigurationError"; } }
export function requireFleetReadProvider(provider: string | undefined) { const value = provider?.trim().toLowerCase() || "supabase"; if (value !== "supabase") throw new FleetReadConfigurationError(value); return value; }
const rows = (result: FleetResult) => Array.isArray(result.data) ? result.data as FleetRow[] : [];
const row = (result: FleetResult) => result.data && !Array.isArray(result.data) ? result.data as FleetRow : null;
export class TenantBoundFleetReadRepository {
  private readonly source: FleetReadDataSource; private readonly departmentId: string;
  constructor(source: FleetReadDataSource, departmentId: string) { if (!departmentId) throw new FleetReadAuthorizationError(); this.source = source; this.departmentId = departmentId; }
  private authorize(id: string) { if (!id || id !== this.departmentId) throw new FleetReadAuthorizationError(); }
  private required(result: FleetResult) { if (result.error) throw new FleetReadRepositoryError(result.error.message, result.error.code); return result; }
  async getVehicleList(input: { departmentId: string; vehicleFields: string }) { this.authorize(input.departmentId); const [rulesResult, vehiclesResult] = await Promise.all([this.source.getRules(input.departmentId, "fleet_manager_role_codes"), this.source.listVehicles(input.departmentId, input.vehicleFields)]); this.required(vehiclesResult); return { rules: row(rulesResult), items: rows(vehiclesResult) }; }
  async getRules(input: { departmentId: string }) { this.authorize(input.departmentId); return row(this.required(await this.source.getRules(input.departmentId, "*"))); }
  async getVehicleDetail(input: { departmentId: string; vehicleId: string; canViewNetworkDetails: (rules: FleetRow | null) => boolean }) {
    this.authorize(input.departmentId); if (!input.vehicleId) throw new FleetReadAuthorizationError();
    const results = await Promise.all([this.source.getVehicle(input.departmentId, input.vehicleId), this.source.listWorkOrders(input.departmentId, input.vehicleId), this.source.listEquipment(input.departmentId, input.vehicleId), this.source.listDocuments(input.departmentId, input.vehicleId), this.source.listInspections(input.departmentId, input.vehicleId), this.source.listHistory(input.departmentId, input.vehicleId), this.source.getRules(input.departmentId, "*")]);
    this.required(results[0]); const vehicle = row(results[0]); if (!vehicle) return null;
    const rules = row(results[6]); const inspectionsRaw = rows(results[4]); const historyRaw = rows(results[5]);
    const actorIds = [...new Set([...inspectionsRaw.map((item) => item.inspector_user_id), ...historyRaw.map((item) => item.actor_user_id)].filter((value): value is string => typeof value === "string" && value.length > 0))];
    const profiles = actorIds.length ? rows(await this.source.listProfiles(actorIds)) : [];
    const names = new Map(profiles.map((profile) => [String(profile.id), typeof profile.full_name === "string" && profile.full_name.trim() ? profile.full_name.trim() : "Unknown user"]));
    const name = (id: unknown) => typeof id === "string" && id ? names.get(id) || "Unknown user" : "System / legacy record";
    return { vehicle, workOrders: rows(results[1]), equipment: rows(results[2]).map((item) => input.canViewNetworkDetails(rules) ? item : { ...item, static_ip: null }), documents: rows(results[3]), inspections: inspectionsRaw.map((item) => ({ ...item, inspector_name: name(item.inspector_user_id) })), history: historyRaw.map((item) => ({ ...item, actor_name: name(item.actor_user_id) })), rules };
  }
}
