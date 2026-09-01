import { evaluateCertificationReadiness, summarizeCertificationReadiness } from "../tracepoint/certification-readiness.ts";
import { evaluateEquipmentReadiness, summarizeEquipmentReadiness, type EquipmentRequirementScope, type EquipmentReadinessAsset } from "../tracepoint/equipment-readiness.ts";

export type ReadinessRow = Record<string, unknown>;
export type ReadinessResult = { data: ReadinessRow[] | null; error: { message: string } | null };
export interface ReadinessDataSource {
  listEquipmentMembers(departmentId: string, userId?: string): PromiseLike<ReadinessResult>;
  listEquipmentTypes(departmentId: string): PromiseLike<ReadinessResult>;
  listEquipmentRequirements(departmentId: string): PromiseLike<ReadinessResult>;
  listEquipmentAssets(departmentId: string, userId?: string): PromiseLike<ReadinessResult>;
  listCertificationMembers(departmentId: string): PromiseLike<ReadinessResult>;
  listCertificationTypes(departmentId: string): PromiseLike<ReadinessResult>;
  listCertificationRequirements(departmentId: string): PromiseLike<ReadinessResult>;
  listCertificationCredentials(departmentId: string): PromiseLike<ReadinessResult>;
  listProfiles(userIds: string[]): PromiseLike<ReadinessResult>;
}
export class ReadinessAuthorizationError extends Error { constructor() { super("Authorized department context is required."); this.name = "ReadinessAuthorizationError"; } }
export class ReadinessRepositoryError extends Error { constructor(message: string) { super(message); this.name = "ReadinessRepositoryError"; } }
export class ReadinessRepositoryConfigurationError extends Error { constructor(provider: string) { super(`Unsupported data provider: ${provider}. Only supabase is implemented.`); this.name = "ReadinessRepositoryConfigurationError"; } }
export function requireReadinessProvider(provider: string | undefined) { const value = provider?.trim().toLowerCase() || "supabase"; if (value !== "supabase") throw new ReadinessRepositoryConfigurationError(value); return value; }
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const nullableNumber = (value: unknown) => value === null || value === undefined ? null : Number(value);
const nullableString = (value: unknown) => value === null || value === undefined ? null : String(value);

export class TenantBoundReadinessRepository {
  private readonly source: ReadinessDataSource;
  private readonly departmentId: string;
  constructor(source: ReadinessDataSource, departmentId: string) { if (!departmentId) throw new ReadinessAuthorizationError(); this.source = source; this.departmentId = departmentId; }
  private authorize(departmentId: string, userId?: string) { if (!departmentId || departmentId !== this.departmentId || userId === "") throw new ReadinessAuthorizationError(); }
  private rows(result: ReadinessResult) { if (result.error) throw new ReadinessRepositoryError(result.error.message); return result.data ?? []; }
  private async profiles(memberRows: ReadinessRow[]) {
    const userIds = memberRows.map((row) => String(row.user_id));
    if (!userIds.length) return new Map<string, ReadinessRow>();
    const result = await this.source.listProfiles(userIds);
    return new Map(this.rows(result).map((row) => [String(row.id), row]));
  }
  async getEquipmentReadiness(input: { departmentId: string; userId: string; canViewDepartment: boolean }) {
    this.authorize(input.departmentId, input.userId);
    const visibleUserId = input.canViewDepartment ? undefined : input.userId;
    const results = await Promise.all([
      this.source.listEquipmentMembers(input.departmentId, visibleUserId), this.source.listEquipmentTypes(input.departmentId),
      this.source.listEquipmentRequirements(input.departmentId), this.source.listEquipmentAssets(input.departmentId, visibleUserId),
    ]);
    const memberRows = this.rows(results[0]); const typeRows = this.rows(results[1]); const requirementRows = this.rows(results[2]); const assetRows = this.rows(results[3]);
    const profiles = await this.profiles(memberRows);
    const members = memberRows.map((row) => ({ userId: String(row.user_id), fullName: text(profiles.get(String(row.user_id))?.full_name) || text(row.rank_title) || "Unnamed Officer", badgeNumber: nullableString(row.badge_number), rankTitle: nullableString(row.rank_title), unitName: nullableString(row.unit_name) }));
    const equipmentTypes = typeRows.map((row) => ({ id: String(row.id), name: String(row.name), category: String(row.category ?? "General"), expirationRequired: row.expiration_required === true, defaultValidDays: nullableNumber(row.default_valid_days), defaultDueSoonDays: Number(row.default_due_soon_days ?? 30), inspectionRequired: row.inspection_required === true, defaultInspectionIntervalDays: nullableNumber(row.default_inspection_interval_days), defaultInspectionDueSoonDays: Number(row.default_inspection_due_soon_days ?? 30) }));
    const requirements = requirementRows.map((row) => ({ equipmentTypeId: String(row.equipment_type_id), isRequired: row.is_required !== false, isActive: row.is_active !== false, requiredQuantity: Math.max(1, Number(row.required_quantity ?? 1)), scopeType: (["rank", "unit", "officer"].includes(String(row.scope_type)) ? row.scope_type : "all") as EquipmentRequirementScope, scopeValue: String(row.scope_value ?? ""), affectsReadiness: row.affects_readiness !== false, validDays: nullableNumber(row.valid_days), dueSoonDays: nullableNumber(row.due_soon_days), inspectionIntervalDays: nullableNumber(row.inspection_interval_days), inspectionDueSoonDays: nullableNumber(row.inspection_due_soon_days) }));
    const assets = assetRows.map((row) => ({ id: String(row.id), userId: row.assigned_user_id ? String(row.assigned_user_id) : null, equipmentTypeId: String(row.equipment_type_id), manufacturer: nullableString(row.manufacturer), model: nullableString(row.model), serialNumber: nullableString(row.serial_number), lotNumber: nullableString(row.lot_number), issueDate: nullableString(row.issue_date), expirationDate: nullableString(row.expiration_date), lastInspectionDate: nullableString(row.last_inspection_date), nextInspectionDate: nullableString(row.next_inspection_date), lifecycleStatus: row.lifecycle_status as EquipmentReadinessAsset["lifecycleStatus"] }));
    const rows = evaluateEquipmentReadiness({ members, equipmentTypes, requirements, assets });
    return { scope: input.canViewDepartment ? "department" as const : "self" as const, summary: summarizeEquipmentReadiness(rows), rows };
  }
  async getCertificationReadiness(input: { departmentId: string }) {
    this.authorize(input.departmentId);
    const results = await Promise.all([
      this.source.listCertificationMembers(input.departmentId), this.source.listCertificationTypes(input.departmentId),
      this.source.listCertificationRequirements(input.departmentId), this.source.listCertificationCredentials(input.departmentId),
    ]);
    const memberRows = this.rows(results[0]); const typeRows = this.rows(results[1]); const requirementRows = this.rows(results[2]); const credentialRows = this.rows(results[3]);
    const profiles = await this.profiles(memberRows);
    const members = memberRows.map((row) => ({ userId: String(row.user_id), fullName: (profiles.get(String(row.user_id))?.full_name as string | null | undefined) || (row.rank_title as string | null | undefined) || "Unnamed Officer", badgeNumber: nullableString(row.badge_number), rankTitle: nullableString(row.rank_title) }));
    const certificationTypes = typeRows.map((row) => ({ id: String(row.id), name: String(row.name), category: String(row.category ?? "General"), expirationRequired: row.expiration_required !== false, defaultValidDays: nullableNumber(row.default_valid_days), defaultDueSoonDays: Number(row.default_due_soon_days ?? 30) }));
    const requirements = requirementRows.map((row) => ({ certificationTypeId: String(row.certification_type_id), isRequired: row.is_required !== false, isActive: row.is_active !== false, validDays: nullableNumber(row.valid_days), dueSoonDays: nullableNumber(row.due_soon_days) }));
    const credentials = credentialRows.filter((row) => row.certification_type_id).map((row) => ({ id: String(row.id), userId: String(row.user_id), certificationTypeId: String(row.certification_type_id), issueDate: nullableString(row.issue_date), expirationDate: nullableString(row.expiration_date), isActive: row.is_active !== false }));
    const rows = evaluateCertificationReadiness({ members, certificationTypes, requirements, credentials });
    return { summary: summarizeCertificationReadiness(rows), rows };
  }
}
