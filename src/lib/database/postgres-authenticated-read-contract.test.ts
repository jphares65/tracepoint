import assert from "node:assert/strict";
import test from "node:test";

import { PostgresDataClient } from "./postgres-data-client.ts";
import { requireFleetReadProvider, TenantBoundFleetReadRepository } from "../fleet/read-repository-core.ts";
import { SupabaseFleetReadDataSource } from "../fleet/read-repository-supabase.ts";
import { requireEquipmentReadProvider } from "../equipment/read-repository-core.ts";
import { SupabaseEquipmentReadDataSource } from "../equipment/read-repository-supabase.ts";
import { requireReadinessProvider } from "../readiness/read-repository-core.ts";
import { SupabaseReadinessDataSource } from "../readiness/read-repository-supabase.ts";
import { requireTrainingReadProvider } from "../training/read-repository-core.ts";
import { SupabaseTrainingReadDataSource } from "../training/read-repository-supabase.ts";
import { requireAgencyTrainingReadProvider } from "../agency-training/read-repository-core.ts";
import { SupabaseAgencyTrainingReadDataSource } from "../agency-training/read-repository-supabase.ts";
import { requireAdministrationReadProvider } from "../administration/read-repository-core.ts";
import { SupabaseAdministrationReadDataSource } from "../administration/read-repository-supabase.ts";
import { requireEvidenceReadProvider } from "../evidence/read-repository-core.ts";
import { SupabaseEvidenceReadDataSource } from "../evidence/read-repository-supabase.ts";
import { requireOffDutyReadProvider } from "../off-duty-firearms/read-repository-core.ts";
import { SupabaseOffDutyReadDataSource } from "../off-duty-firearms/read-repository-supabase.ts";
import { requireOperationsReadProvider } from "../operations/read-repository-core.ts";
import { SupabaseOperationsReadDataSource } from "../operations/read-repository-supabase.ts";
import { requirePolicyReadProvider } from "../policy-metadata/read-repository-core.ts";
import { SupabasePolicyReadDataSource } from "../policy-metadata/read-repository-supabase.ts";
import { requirePlatformReadProvider } from "../platform/read-repository-core.ts";
import { SupabasePlatformReadDataSource } from "../platform/read-repository-supabase.ts";
import { requireSettingsOverviewProvider } from "../settings/overview-repository-core.ts";
import { SupabaseSettingsOverviewDataSource } from "../settings/overview-repository-supabase.ts";
import { createCourseCatalogRepository } from "../agency-training/course-catalog-repository-core.ts";
import { createCertificationTypeCatalogRepository } from "../certifications/type-catalog-repository-core.ts";
import { createQualificationHistoryRepository } from "../qualifications/history-repository-core.ts";

const departmentId = "20000000-0000-4000-8000-000000000001";
const otherDepartmentId = "20000000-0000-4000-8000-000000000002";
const subjectId = "10000000-0000-4000-8000-000000000001";

function fixture(rowsByTable: Record<string, Record<string, unknown>[]> = {}) {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const pool = {
    async connect() {
      return {
        async query(sql: string, values?: readonly unknown[]) {
          calls.push({ sql, values });
          const table = sql.match(/from public\."([a-z_]+)" t(?: |$)/)?.[1];
          const rows = table ? (rowsByTable[table] ?? []) : [];
          return { rows, rowCount: rows.length };
        },
        release() {},
      };
    },
  };
  return { client: new PostgresDataClient(pool as never, subjectId, departmentId), calls };
}

test("all routed authenticated read dispatchers admit PostgreSQL, not arbitrary providers", () => {
  const guards = [
    requireFleetReadProvider, requireEquipmentReadProvider, requireReadinessProvider,
    requireTrainingReadProvider, requireAgencyTrainingReadProvider,
    requireAdministrationReadProvider, requireEvidenceReadProvider,
    requireOffDutyReadProvider, requireOperationsReadProvider, requirePolicyReadProvider,
    requirePlatformReadProvider, requireSettingsOverviewProvider,
  ];
  for (const guard of guards) {
    assert.doesNotThrow(() => guard("postgres"));
    assert.throws(() => guard("unknown"), /Unsupported data provider/);
  }
  const { client } = fixture();
  assert.doesNotThrow(() => createCourseCatalogRepository(client as never, departmentId, { TRACEPOINT_DATA_PROVIDER: "postgres" }));
  assert.doesNotThrow(() => createCertificationTypeCatalogRepository(client as never, departmentId, { TRACEPOINT_DATA_PROVIDER: "postgres" }));
  assert.doesNotThrow(() => createQualificationHistoryRepository(client as never, departmentId, { TRACEPOINT_DATA_PROVIDER: "postgres" }));
});

test("Fleet PostgreSQL read preserves tenant boundary, sorting, empty rules and authenticated context", async () => {
  const value = fixture({ fleet_vehicles: [
    { id: "v2", unit_number: "20" }, { id: "v1", unit_number: "3" },
  ] });
  const repository = new TenantBoundFleetReadRepository(new SupabaseFleetReadDataSource(value.client as never), departmentId);
  await assert.rejects(repository.getVehicleList({ departmentId: otherDepartmentId, vehicleFields: "id,unit_number" }));
  assert.equal(value.calls.length, 0);
  const result = await repository.getVehicleList({ departmentId, vehicleFields: "id,unit_number" });
  assert.deepEqual(result.items.map(row => row.id), ["v1", "v2"]);
  assert.equal(result.rules, null);
  const selects = value.calls.filter(call => call.sql.startsWith("select ") && call.sql.includes(" from public."));
  assert.equal(selects.length, 2);
  for (const select of selects) {
    assert.match(select.sql, /where t\."department_id" = \$1/);
    assert.deepEqual(select.values, [departmentId]);
  }
  assert.equal(value.calls.filter(call => call.sql === "set local role authenticated").length, 2);
});

test("remaining PostgreSQL read data sources use tenant-bound, parameterized SELECTs and return empty sets", async () => {
  const value = fixture({ departments: [{ id: departmentId }] });
  const client = value.client as never;
  const checks: Array<PromiseLike<{ data: unknown; error: unknown }>> = [
    new SupabaseEquipmentReadDataSource(client).listTypes(departmentId).then(data => ({ data, error: null })),
    new SupabaseReadinessDataSource(client).listEquipmentTypes(departmentId),
    new SupabaseTrainingReadDataSource(client).listCertifications(departmentId),
    new SupabaseAgencyTrainingReadDataSource(client).listEvents(departmentId),
    new SupabaseAdministrationReadDataSource(client).listAudit("audit_events", "id,created_at", departmentId, 10),
    new SupabaseEvidenceReadDataSource(client).listFirearmAttachments(departmentId, "asset-id"),
    new SupabaseOffDutyReadDataSource(client).listRequests(departmentId),
    new SupabaseOperationsReadDataSource(client).listFleetVehicles(departmentId),
    new SupabasePolicyReadDataSource(client).listCertificationCapabilities(departmentId),
    new SupabaseSettingsOverviewDataSource(client, client).getDepartment(departmentId),
  ];
  const results = await Promise.all(checks);
  assert.deepEqual(results.map(result => result.error), Array(checks.length).fill(null));
  const selects = value.calls.filter(call => call.sql.startsWith("select ") && call.sql.includes(" from public."));
  assert.equal(selects.length, checks.length);
  for (const select of selects) {
    assert.match(select.sql, /t\."department_id" = \$1|t\."id" = \$1/);
    assert.equal(select.values?.[0], departmentId);
  }
  assert.equal(value.calls.filter(call => call.sql === "set local role authenticated").length, checks.length);
});

test("nested training and membership reads stay on the PostgreSQL client", async () => {
  const value = fixture();
  const client = value.client as never;
  const requests = [
    new SupabaseAgencyTrainingReadDataSource(client).listRequirements(departmentId),
    new SupabasePlatformReadDataSource(client).listFeatureCatalog(),
    createCourseCatalogRepository(client, departmentId, { TRACEPOINT_DATA_PROVIDER: "postgres" }).listActiveCourses({ departmentId }),
    createCertificationTypeCatalogRepository(client, departmentId, { TRACEPOINT_DATA_PROVIDER: "postgres" }).listTypes({ departmentId }),
    createQualificationHistoryRepository(client, departmentId, { TRACEPOINT_DATA_PROVIDER: "postgres" }).listImportedHistory({ departmentId }),
  ];
  await Promise.all(requests);
  const selects = value.calls.filter(call => call.sql.startsWith("select ") && call.sql.includes(" from public."));
  assert.equal(selects.length, requests.length);
  assert.ok(selects.every(select => !select.sql.includes("supabase")));
  assert.ok(selects.some(select => select.sql.includes('public."agency_training_courses" r')));
  assert.ok(selects.some(select => select.sql.includes('public."agency_training_course_aliases" r')));
});
