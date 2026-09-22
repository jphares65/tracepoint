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
