import assert from "node:assert/strict";
import test from "node:test";

import { executeApprovedImport } from "./server/execution.ts";
import type { ImportPayload, PreviewRow } from "./types.ts";

type Call = { table: string; method: string; record?: Record<string, unknown>; filters: Array<[string, unknown]> };

class FakeQuery implements PromiseLike<{ data: unknown; error: { code: string; message: string } | null }> {
  private call: Call;
  private calls: Call[];
  private table: string;
  constructor(calls: Call[], table: string) {
    this.calls = calls;
    this.table = table;
    this.call = { table, method: "select", filters: [] };
  }
  insert(record: Record<string, unknown>) { this.call = { table: this.table, method: "insert", record, filters: [] }; this.calls.push(this.call); return this; }
  update(record: Record<string, unknown>) { this.call = { table: this.table, method: "update", record, filters: [] }; this.calls.push(this.call); return this; }
  select() { return this; }
  eq(column: string, value: unknown) { this.call.filters.push([column, value]); return this; }
  single() { return this; }
  then<TResult1 = { data: unknown; error: { code: string; message: string } | null }, TResult2 = never>(onfulfilled?: ((value: { data: unknown; error: { code: string; message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    void onrejected;
    const failed = this.table === "equipment_assets" && this.call.method === "insert" && this.call.record?.serial_number === "BAD";
    const result = failed ? { data: null, error: { code: "23505", message: "sensitive provider detail" } } : { data: { id: "created-id" }, error: null };
    return Promise.resolve(onfulfilled ? onfulfilled(result) : result as TResult1);
  }
}

function admin() {
  const calls: Call[] = [];
  return { calls, client: { from(table: string) { return new FakeQuery(calls, table); } } };
}

const payload: ImportPayload = {
  file: { name: "assets.csv", size: 100, sha256: "c".repeat(64), type: "text/csv", sheetCount: 1 },
  domain: "equipment", sheetName: "Assets", headerRow: 1, matrix: [["Serial"]],
  mappings: [{ sourceColumn: "Serial", targetField: "serialNumber", confidence: "High", samples: [] }],
};

function row(rowNumber: number, action: PreviewRow["action"], serialNumber: string): PreviewRow {
  return { rowNumber, action, status: "valid", values: { equipmentTypeId: "type-a", serialNumber, lifecycleStatus: "active" }, issues: [], changes: [], matchId: action === "UPDATE" ? "asset-a" : undefined };
}

test("approved execution is deterministic, tenant-scoped, audited, and reports rejected rows", async () => {
  const fake = admin();
  const result = await executeApprovedImport(fake.client as unknown as Parameters<typeof executeApprovedImport>[0], payload, "dept-a", "actor-a", [
    row(2, "CREATE", "GOOD"), row(3, "UPDATE", "EXISTING"), row(4, "SKIP", "SAME"), row(5, "CREATE", "BAD"),
  ]);
  assert.deepEqual({ created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed }, { created: 1, updated: 1, skipped: 1, failed: 1 });
  assert.deepEqual(result.rejectedRows.map((item) => item.rowNumber), [5]);
  assert.match(result.rejectedRows[0].reason, /duplicate identifier/i);
  assert.doesNotMatch(result.rejectedRows[0].reason, /sensitive provider detail/);
  const audits = fake.calls.filter((call) => call.table === "audit_events");
  assert.equal(audits.length, 2);
  assert.equal(audits[0].record?.action, "ai_import_approved");
  assert.equal(audits[1].record?.action, "ai_import_completed_with_failures");
  for (const call of fake.calls) {
    if (call.method === "insert") assert.equal(call.record?.department_id, "dept-a");
    if (call.method === "update") assert.deepEqual(call.filters.find(([column]) => column === "department_id"), ["department_id", "dept-a"]);
  }
});

test("execution processes more than one safe batch without dropping rows", async () => {
  const fake = admin();
  const rows = Array.from({ length: 205 }, (_, index) => row(index + 2, "SKIP", `S${index}`));
  const result = await executeApprovedImport(fake.client as unknown as Parameters<typeof executeApprovedImport>[0], payload, "dept-a", "actor-a", rows);
  assert.equal(result.skipped, 205);
  assert.equal(result.failed, 0);
  assert.equal(fake.calls.filter((call) => call.table === "audit_events").length, 2);
});

test("AWS personnel execution uses the injected identity writer without evaluating the legacy auth client", async () => {
  const fake = admin();
  const personnelPayload: ImportPayload = {
    ...payload,
    domain: "personnel",
    mappings: [{ sourceColumn: "Email", targetField: "email", confidence: "High", samples: [] }],
  };
  const personnelRow: PreviewRow = {
    rowNumber: 2,
    action: "CREATE",
    status: "valid",
    values: { email: "synthetic@example.test", badgeNumber: "S-1", fullName: "Synthetic User", active: true },
    issues: [],
    changes: [],
  };
  const calls: Array<{ departmentId: string; actorId: string; rowNumber: number }> = [];
  const result = await executeApprovedImport(
    fake.client as unknown as Parameters<typeof executeApprovedImport>[0],
    personnelPayload,
    "dept-a",
    "actor-a",
    [personnelRow],
    {},
    {
      personnel: async ({ departmentId, actorId, row }) => {
        calls.push({ departmentId, actorId, rowNumber: row.rowNumber });
      },
    },
  );
  assert.deepEqual(calls, [{ departmentId: "dept-a", actorId: "actor-a", rowNumber: 2 }]);
  assert.equal(result.created, 1);
  assert.equal(result.failed, 0);
});
