import assert from "node:assert/strict";
import test from "node:test";

import { PostgresDataClient } from "./postgres-data-client.ts";

const subjectId = "10000000-0000-4000-8000-000000000001";
const departmentId = "20000000-0000-4000-8000-000000000001";

function fixture(rows: Record<string, unknown>[] = []) {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  const connection = {
    async query(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      if (text.startsWith("select ") && !text.includes("set_config")) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = { async connect() { return connection; } };
  return { client: new PostgresDataClient(pool as never, subjectId, departmentId), calls };
}

test("tenant-bound selects use one authorized transaction and parameterized filters", async () => {
  const value = fixture([{ id: "asset-1", name: "Radio" }]);
  const result = await value.client.from("equipment_types").select("id,name").eq("department_id", departmentId).order("name").limit(1).maybeSingle();
  assert.deepEqual(result.data, { id: "asset-1", name: "Radio" });
  assert.deepEqual(value.calls.slice(0, 4).map(call => call.text), [
    "begin", "set local role authenticated",
    "select set_config('tracepoint.subject_id', $1, true)",
    "select set_config('tracepoint.department_id', $1, true)",
  ]);
  assert.match(value.calls[4].text, /from public\."equipment_types" t where t\."department_id" = \$1 order by t\."name" asc limit 1/);
  assert.deepEqual(value.calls[4].values, [departmentId]);
  assert.equal(value.calls[5].text, "commit");
});

test("accepts Cognito-era UUID layouts for a scoped support context", () => {
  const pool = { async connect() { throw new Error("not used"); } };
  assert.doesNotThrow(() => new PostgresDataClient(
    pool as never,
    "04a874b8-c0b1-700d-e816-26758473bde3",
    "14a874b8-c0b1-700d-e816-26758473bde3",
    null,
    true,
  ));
});

test("upserts keep explicit conflicts and all values parameterized", async () => {
  const value = fixture();
  const result = await value.client.from("department_features").upsert([
    { department_id: departmentId, feature_code: "fleet", is_enabled: true },
  ], { onConflict: "department_id,feature_code" }).select("department_id,feature_code");
  assert.equal(result.error, null);
  const statement = value.calls.find(call => call.text.startsWith("insert into"));
  assert.match(statement?.text ?? "", /on conflict\("department_id","feature_code"\) do update set "is_enabled"=excluded\."is_enabled"/);
  assert.deepEqual(statement?.values, [departmentId, "fleet", true]);
});

test("JSON document columns serialize arrays without changing PostgreSQL array parameters", async () => {
  const inspection = fixture();
  await inspection.client.from("fleet_vehicle_inspections").insert({ department_id: departmentId, checklist: [{ id: "body", condition: "Pass" }] });
  assert.deepEqual(inspection.calls.find(call => call.text.startsWith("insert into"))?.values, [departmentId, '[{"id":"body","condition":"Pass"}]']);
  const rpc = fixture([{ set_department_role_permissions: ["administrator"] }]);
  await rpc.client.rpc("set_department_role_permissions", { p_department_id: departmentId, p_role_code: "administrator", p_permission_codes: ["administer_department"] });
  assert.deepEqual(rpc.calls.find(call => call.text.includes("public.\"set_department_role_permissions\""))?.values?.[2], ["administer_department"]);
});

test("Range Day workspace writes use jsonb parameters and retain tenant and optimistic-lock filters", async () => {
  const value = fixture([{ department_id: departmentId }]);
  const updatedAt = "2026-10-05T17:00:00.000Z";
  const previousUpdatedAt = "2026-10-05T16:59:59.000Z";
  const workspace = {
    rangeDays: [{ id: "day-1", title: "Range Day" }],
    drillLibrary: [{ id: "template-1", name: "Library drill" }],
    rangeDayDrills: [{ id: "assignment-1", rangeDayId: "day-1", sourceTemplateId: "template-1" }],
    rangeRoster: [], results: [], malfunctions: [],
  };

  const result = await value.client.from("pilot_range_workspaces").update({
    department_id: departmentId,
    workspace,
    updated_by_user_id: subjectId,
    updated_at: updatedAt,
  }).eq("department_id", departmentId).eq("updated_at", previousUpdatedAt)
    .select("department_id").maybeSingle();

  assert.equal(result.error, null);
  assert.equal(result.data, null);
  const statement = value.calls.find(call => call.text.startsWith("update public.\"pilot_range_workspaces\""));
  assert.match(statement?.text ?? "", /"workspace"=\$2/);
  assert.match(statement?.text ?? "", /where t\."department_id" = \$5 and t\."updated_at" = \$6/);
  assert.deepEqual(statement?.values, [
    departmentId,
    JSON.stringify(workspace),
    subjectId,
    updatedAt,
    departmentId,
    previousUpdatedAt,
  ]);
});

test("default and ignore-duplicate upserts preserve Supabase mutation contracts", async () => {
  const defaultValue = fixture();
  const result = await defaultValue.client.from("notification_events").upsert({ department_id: departmentId, notification_key: "key" });
  assert.equal(result.data, null);
  assert.match(defaultValue.calls.find(call => call.text.startsWith("insert into"))?.text ?? "", /on conflict\("id"\) do update/);
  assert.doesNotMatch(defaultValue.calls.find(call => call.text.startsWith("insert into"))?.text ?? "", /returning/);

  const ignored = fixture();
  await ignored.client.from("notification_email_queue").upsert({ department_id: departmentId, notification_key: "key" }, { onConflict: "department_id,notification_key", ignoreDuplicates: true });
  assert.match(ignored.calls.find(call => call.text.startsWith("insert into"))?.text ?? "", /do nothing/);
});

test("RPC arguments are named, parameterized, and scoped to the same request identity", async () => {
  const value = fixture([{ set_department_role_permissions: ["administrator"] }]);
  const result = await value.client.rpc("set_department_role_permissions", { p_department_id: departmentId, p_role_code: "administrator", p_permission_codes: ["administer_department"] });
  assert.deepEqual(result.data, ["administrator"]);
  const statement = value.calls.find(call => call.text.includes("public.\"set_department_role_permissions\""));
  assert.match(statement?.text ?? "", /"p_department_id" => \$1/);
  assert.deepEqual(statement?.values, [departmentId, "administrator", ["administer_department"]]);
});

test("fleet OR and NOT IN filters remain parameterized", async () => {
  const value = fixture();
  await value.client.from("fleet_work_orders").select("id,status").eq("department_id", departmentId).not("status", "in", '("Completed","Cancelled")').or("is_required.eq.true,is_critical.eq.true");
  const statement = value.calls.find(call => call.text.includes('from public."fleet_work_orders"'));
  assert.match(statement?.text ?? "", /t\."status"<>all\(\$2\)/);
  assert.match(statement?.text ?? "", /\(t\."is_required" = \$3 or t\."is_critical" = \$4\)/);
  assert.deepEqual(statement?.values, [departmentId, ["Completed", "Cancelled"], true, true]);
});

test("inner relation filters constrain both embedded data and parent rows", async () => {
  const value = fixture();
  await value.client.from("agency_training_attendees")
    .select("user_id,agency_training_events!inner(course_id,starts_at,status)")
    .eq("department_id", departmentId)
    .eq("agency_training_events.status", "completed");
  const statement = value.calls.find(call => call.text.includes('from public."agency_training_attendees"'));
  assert.match(statement?.text ?? "", /r\."status" = \$2/);
  assert.match(statement?.text ?? "", /exists\(select 1 from public\."agency_training_events" r where/);
  assert.deepEqual(statement?.values, [departmentId, "completed"]);
});

test("armory joins use the committed foreign keys and preserve nested aliases", async () => {
  const ammunition = fixture();
  await ammunition.client.from("ammunition_transactions").select("id,lot:ammunition_lots(caliber,manufacturer)");
  const ammunitionSql = ammunition.calls.find(call => call.text.includes('from public."ammunition_transactions"'))?.text ?? "";
  assert.match(ammunitionSql, /r\."id"=t\."lot_id"/);
  assert.doesNotMatch(ammunitionSql, /ammunition_lot_id/);

  const inspections = fixture();
  await inspections.client.from("firearm_inspections").select("id,firearm:firearms(id,serial_number),items:firearm_inspection_items(id,status)");
  const inspectionSql = inspections.calls.find(call => call.text.includes('from public."firearm_inspections"'))?.text ?? "";
  assert.match(inspectionSql, /r\."id"=t\."firearm_id"/);
  assert.match(inspectionSql, /r\."inspection_id"=t\."id"/);
  assert.match(inspectionSql, /as "firearm"/);
  assert.match(inspectionSql, /as "items"/);
});

test("invalid identifiers and database failures return non-sensitive errors", async () => {
  assert.throws(() => fixture().client.from("profiles;drop table profiles"), /identifier/);
  const pool = { async connect() { return { async query(text: string) { if (text === "begin") return {}; if (text === "rollback") return {}; throw Object.assign(new Error("secret SQL detail"), { code: "42501" }); }, release() {} }; } };
  const result = await new PostgresDataClient(pool as never, subjectId, departmentId).from("profiles").select("id");
  assert.deepEqual(result.error, { message: "PostgreSQL data operation failed.", code: "42501" });
  assert.equal(JSON.stringify(result).includes("secret SQL detail"), false);
});

// AT-4 (staging acceptance 2026-10-22, A4/A5): an Armory refusal raised on purpose by a TracePoint function reached the
// officer as "PostgreSQL data operation failed." It is passed through; any other database error stays generic.
test("a refusal a TracePoint function raises on purpose is passed through; other database errors stay generic", async () => {
  const failing = (error: Record<string, unknown>) => ({ async connect() { return { async query(text: string) { if (text === "begin" || text === "rollback") return {}; throw Object.assign(new Error(String(error.message)), error); }, release() {} }; } });
  const rpc = async (error: Record<string, unknown>) => (await new PostgresDataClient(failing(error) as never, subjectId, departmentId).rpc("set_firearm_restriction", {})).error;
  assert.deepEqual(await rpc({ code: "22023", message: "restricted use requires an active assignment", where: "PL/pgSQL function set_firearm_restriction(uuid,text,date,text,text,date) line 15 at RAISE" }),
    { message: "restricted use requires an active assignment", code: "22023" });
  for (const [label, error] of [
    ["a constraint violation", { code: "23505", message: 'duplicate key value violates unique constraint "firearms_serial_key"', where: "SQL statement \"insert into ...\"\nPL/pgSQL function f() line 3 at SQL statement" }],
    ["an error whose innermost frame is not a RAISE", { code: "22023", message: "internal detail", where: "SQL statement \"select g()\"\nPL/pgSQL function f() line 2 at RAISE" }],
    ["an invalid SQLSTATE (42704)", { code: "42704", message: 'unrecognized exception condition "409"', where: "PL/pgSQL function f() line 1 at RAISE" }],
    ["a message too long to be a designed refusal", { code: "P0001", message: "x".repeat(201), where: "PL/pgSQL function f() line 1 at RAISE" }],
    ["an error with no function context", { code: "42501", message: "permission denied for table firearms" }],
  ] as const) {
    assert.equal((await rpc(error))?.message, "PostgreSQL data operation failed.", label);
  }
});

test("notification dispatcher is cross-tenant only for its two reviewed tables", async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  const dispatcher = PostgresDataClient.forNotificationDispatch({
    query: async (text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      return { rows: [{ id: "queued" }], rowCount: 1 };
    },
  } as never);
  const result = await dispatcher.from("notification_email_queue").select("id").eq("status", "Pending");
  assert.deepEqual(result.data, [{ id: "queued" }]);
  assert.equal(calls.some(call => call.text === "set local role authenticated"), false);
  assert.throws(() => dispatcher.from("profiles"), /table access rejected/);
});

test("transaction runs several statements in one authorized transaction and rolls back on failure", async () => {
  const value = fixture();
  await value.client.transaction(async (tx) => {
    await tx.query("select 1 from public.ammunition_reconciliations where id = $1 for update", ["r"]);
    await tx.query("update public.ammunition_reconciliations set notes = $1", ["n"]);
  });
  assert.deepEqual(value.calls.map(call => call.text), [
    "begin", "set local role authenticated",
    "select set_config('tracepoint.subject_id', $1, true)",
    "select set_config('tracepoint.department_id', $1, true)",
    "select 1 from public.ammunition_reconciliations where id = $1 for update",
    "update public.ammunition_reconciliations set notes = $1",
    "commit",
  ]);
  const failing = fixture();
  await assert.rejects(failing.client.transaction(async (tx) => { await tx.query("delete from x"); throw new Error("conflict"); }), /conflict/);
  assert.deepEqual(failing.calls.slice(-2).map(call => call.text), ["delete from x", "rollback"]);
});
