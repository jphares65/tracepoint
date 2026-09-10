import "server-only";

import { resolveAuthenticatedPrincipal } from "@/lib/authentication/request-session";
import { getPostgresPool } from "@/lib/database/postgres-pool";
import { withPostgresSubjectAuthorization, type PostgresAuthorizationPool } from "@/lib/database/postgres-authorization-core";

export type PlatformAgency = {
  id: string;
  name: string;
  short_name: string | null;
  slug: string;
  state: string | null;
  county: string | null;
  agency_type: string | null;
  timezone: string | null;
  sworn_officers: number | null;
  civilian_staff: number | null;
  is_active: boolean;
  created_at: string;
  platformAccount: {
    account_status: string;
    plan_type: string;
    onboarding_status: string;
    pilot_start_date: string | null;
    production_start_date: string | null;
    internal_notes?: string | null;
  } | null;
};

export type CreatePlatformAgencyInput = {
  name: string;
  shortName: string;
  slug: string;
  state?: string;
  county?: string;
  agencyType: string;
  timezone: string;
  swornOfficers: number;
  civilianStaff: number;
  accountStatus: string;
  planType: string;
  internalNotes?: string;
};

export type PlatformAgencyMember = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  badge_number: string | null;
  rank_title: string | null;
  is_active: boolean;
  activation_status: string | null;
};

export interface PlatformAdminRepository {
  listAgencies(): Promise<PlatformAgency[]>;
  createAgency(input: CreatePlatformAgencyInput): Promise<string>;
  getAgency(departmentId: string): Promise<{ agency: PlatformAgency; members: PlatformAgencyMember[] } | null>;
  assignAdministrator(departmentId: string, userId: string): Promise<void>;
  listEntitlements(): Promise<{ departments: Record<string, unknown>[]; features: Record<string, unknown>[]; entitlements: Record<string, unknown>[] }>;
  setEntitlement(input: { departmentId: string; featureCode: string; isEnabled: boolean; reason?: string }): Promise<void>;
}

export class PlatformAdminOperationError extends Error {
  constructor(readonly code?: string) {
    super("The platform operation could not be completed.");
    this.name = "PlatformAdminOperationError";
  }
}

function databaseCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : undefined;
}

class PostgresPlatformAdminRepository implements PlatformAdminRepository {
  constructor(private readonly pool: PostgresAuthorizationPool, private readonly subjectId: string) {}

  async listAgencies() {
    return withPostgresSubjectAuthorization(this.pool, { subjectId: this.subjectId }, async client => {
      const result = await client.query("select * from public.list_platform_agencies()") as { rows: Array<Record<string, unknown>> };
      return result.rows.map(row => ({
        id: String(row.id), name: String(row.name), short_name: row.short_name ? String(row.short_name) : null,
        slug: String(row.slug), state: row.state ? String(row.state) : null, county: row.county ? String(row.county) : null,
        agency_type: row.agency_type ? String(row.agency_type) : null, timezone: row.timezone ? String(row.timezone) : null,
        sworn_officers: row.sworn_officers == null ? null : Number(row.sworn_officers),
        civilian_staff: row.civilian_staff == null ? null : Number(row.civilian_staff),
        is_active: row.is_active === true, created_at: String(row.created_at),
        platformAccount: row.account_status ? {
          account_status: String(row.account_status), plan_type: String(row.plan_type), onboarding_status: String(row.onboarding_status),
          pilot_start_date: row.pilot_start_date ? String(row.pilot_start_date) : null,
          production_start_date: row.production_start_date ? String(row.production_start_date) : null,
          internal_notes: row.internal_notes ? String(row.internal_notes) : null,
        } : null,
      }));
    });
  }

  async createAgency(input: CreatePlatformAgencyInput) {
    try {
      return await withPostgresSubjectAuthorization(this.pool, { subjectId: this.subjectId }, async client => {
        const result = await client.query(
          "select public.platform_create_agency($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as department_id",
          [input.name, input.shortName, input.slug, input.state ?? null, input.county ?? null, input.agencyType, input.timezone, input.swornOfficers, input.civilianStaff, input.accountStatus, input.planType, input.internalNotes ?? null],
        ) as { rows: Array<{ department_id?: unknown }> };
        const id = String(result.rows[0]?.department_id ?? "");
        if (!id) throw new Error("missing result");
        return id;
      });
    } catch (error) {
      throw new PlatformAdminOperationError(databaseCode(error));
    }
  }

  async getAgency(departmentId: string) {
    const agencies = await this.listAgencies();
    const agency = agencies.find(item => item.id === departmentId);
    if (!agency) return null;
    const members = await withPostgresSubjectAuthorization(this.pool, { subjectId: this.subjectId }, async client => {
      const result = await client.query("select * from public.get_department_members($1)", [departmentId]) as { rows: Array<Record<string, unknown>> };
      return result.rows.map(row => ({
        user_id: String(row.user_id), full_name: row.full_name ? String(row.full_name) : null,
        email: row.email ? String(row.email) : null, badge_number: row.badge_number ? String(row.badge_number) : null,
        rank_title: row.rank_title ? String(row.rank_title) : null, is_active: row.is_active === true,
        activation_status: row.activation_status ? String(row.activation_status) : null,
      }));
    });
    return { agency, members };
  }

  async assignAdministrator(departmentId: string, userId: string) {
    try {
      await withPostgresSubjectAuthorization(this.pool, { subjectId: this.subjectId }, async client => {
        await client.query("select public.set_department_member_roles($1,$2,$3::text[])", [departmentId, userId, ["officer", "administrator"]]);
      });
    } catch (error) {
      throw new PlatformAdminOperationError(databaseCode(error));
    }
  }

  async listEntitlements() {
    return withPostgresSubjectAuthorization(this.pool, { subjectId: this.subjectId }, async client => {
      const result = await client.query("select public.get_platform_entitlements() as value") as { rows: Array<{ value?: unknown }> };
      const value = result.rows[0]?.value as { departments?: unknown; features?: unknown; entitlements?: unknown } | undefined;
      if (!value || !Array.isArray(value.departments) || !Array.isArray(value.features) || !Array.isArray(value.entitlements)) {
        throw new PlatformAdminOperationError();
      }
      return {
        departments: value.departments as Record<string, unknown>[],
        features: value.features as Record<string, unknown>[],
        entitlements: value.entitlements as Record<string, unknown>[],
      };
    });
  }

  async setEntitlement(input: { departmentId: string; featureCode: string; isEnabled: boolean; reason?: string }) {
    try {
      await withPostgresSubjectAuthorization(this.pool, { subjectId: this.subjectId }, async client => {
        await client.query("select public.set_platform_entitlement($1,$2,$3,$4)", [input.departmentId, input.featureCode, input.isEnabled, input.reason ?? null]);
      });
    } catch (error) {
      throw new PlatformAdminOperationError(databaseCode(error));
    }
  }
}

export type PlatformAdminAccessResult =
  | { ok: true; userId: string; repository: PlatformAdminRepository }
  | { ok: false; status: 401 | 403 | 500 };

export async function resolvePlatformAdminAccess(): Promise<PlatformAdminAccessResult> {
  if (process.env.TRACEPOINT_DATA_PROVIDER === "postgres") {
    try {
      const principal = await resolveAuthenticatedPrincipal();
      if (!principal) return { ok: false, status: 401 };
      const pool = getPostgresPool();
      const allowed = await withPostgresSubjectAuthorization(pool, { subjectId: principal.userId }, async client => {
        const result = await client.query("select public.is_platform_admin() as allowed") as { rows: Array<{ allowed?: unknown }> };
        return result.rows[0]?.allowed === true;
      });
      if (!allowed) return { ok: false, status: 403 };
      return { ok: true, userId: principal.userId, repository: new PostgresPlatformAdminRepository(pool, principal.userId) };
    } catch {
      return { ok: false, status: 500 };
    }
  }

  const [{ createClient }, { createAdminClient }, { createPlatformReadRepository }] = await Promise.all([
    import("@/lib/supabase/server"), import("@/lib/supabase/admin"), import("@/lib/platform/read-repository"),
  ]);
  const client = await createClient();
  const userResult = await client.auth.getUser();
  const user = userResult.data.user;
  if (userResult.error || !user) return { ok: false, status: 401 };
  const admin = await client.rpc("is_platform_admin");
  if (admin.error || admin.data !== true) return { ok: false, status: 403 };
  const reads = createPlatformReadRepository(client, true);
  const bridgeAdmin = createAdminClient();
  const repository: PlatformAdminRepository = {
    async listAgencies() {
      const { departments, accounts } = await reads.listAgencies();
      const accountMap = new Map(accounts.map(account => [String(account.department_id), account]));
      return departments.map(department => ({
        ...(department as Omit<PlatformAgency, "platformAccount">),
        platformAccount: (accountMap.get(String(department.id)) as PlatformAgency["platformAccount"]) ?? null,
      }));
    },
    async createAgency(input) {
      const result = await client.rpc("platform_create_agency", {
        p_name: input.name, p_short_name: input.shortName, p_slug: input.slug, p_state: input.state,
        p_county: input.county, p_agency_type: input.agencyType, p_timezone: input.timezone,
        p_sworn_officers: input.swornOfficers, p_civilian_staff: input.civilianStaff,
        p_account_status: input.accountStatus, p_plan_type: input.planType, p_internal_notes: input.internalNotes,
      });
      if (result.error) throw new PlatformAdminOperationError(result.error.code);
      return String(result.data);
    },
    async getAgency(departmentId) {
      const agencies = await this.listAgencies();
      const agency = agencies.find(item => item.id === departmentId);
      if (!agency) return null;
      const result = await client.rpc("get_department_members", { p_department_id: departmentId });
      if (result.error) throw new PlatformAdminOperationError(result.error.code);
      return { agency, members: (result.data ?? []) as PlatformAgencyMember[] };
    },
    async assignAdministrator(departmentId, userId) {
      const membership = await bridgeAdmin.from("department_memberships").select("user_id").eq("department_id", departmentId).eq("user_id", userId).maybeSingle();
      if (membership.error || !membership.data) throw new PlatformAdminOperationError(membership.error?.code || "P0002");
      const result = await client.rpc("set_department_member_roles", { p_department_id: departmentId, p_user_id: userId, p_role_codes: ["officer", "administrator"] });
      if (result.error) throw new PlatformAdminOperationError(result.error.code);
    },
    async listEntitlements() {
      return reads.listEntitlements();
    },
    async setEntitlement(input) {
      const current = await bridgeAdmin.from("department_features").select("is_enabled").eq("department_id", input.departmentId).eq("feature_code", input.featureCode).maybeSingle();
      if (current.error) throw new PlatformAdminOperationError(current.error.code);
      const now = new Date().toISOString();
      const updated = await bridgeAdmin.from("department_features").upsert({
        department_id: input.departmentId, feature_code: input.featureCode, is_enabled: input.isEnabled,
        enabled_at: input.isEnabled ? now : null, disabled_at: input.isEnabled ? null : now, updated_at: now, updated_by: user.id,
      }, { onConflict: "department_id,feature_code" });
      if (updated.error) throw new PlatformAdminOperationError(updated.error.code);
      if ((current.data?.is_enabled ?? true) !== input.isEnabled) {
        const event = await bridgeAdmin.from("department_feature_events").insert({
          department_id: input.departmentId, feature_code: input.featureCode,
          previous_enabled: current.data?.is_enabled ?? true, new_enabled: input.isEnabled,
          actor_user_id: user.id, reason: input.reason ?? null,
        });
        if (event.error) throw new PlatformAdminOperationError(event.error.code);
      }
    },
  };
  return { ok: true, userId: user.id, repository };
}
