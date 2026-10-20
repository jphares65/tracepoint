// ARM-01 isolated reproduction of the server side of /api/mobile/qr/resolve (worktree code imported read-only).
import pg from "pg";
const CUR = "/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/current";
const { buildTracePointQrValue } = await import(`${CUR}/src/lib/tracepoint/qr-identifiers.ts`);
const { qrDecision } = await import(`${CUR}/src/lib/tracepoint/mobile-workflows.ts`);
const { PostgresDataClient } = await import(`${CUR}/src/lib/database/postgres-data-client.ts`);
// Copied verbatim from src/app/api/mobile/qr/resolve/route.ts:5-6 (route module imports next/server, so it is not imported directly)
const identifier = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 2048) : "";
const opaqueHandle = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

const A = "aaaaaaaa-0000-4000-8000-000000000001", armorerA = "dddddddd-0000-4000-8000-000000000004", firearm = "eeeeeeee-0000-4000-8000-000000000005";
console.log("--- 1. Printed web labels vs resolver input validation");
for (const v of [buildTracePointQrValue("vehicle", "11111111-0000-4000-8000-000000000001"), buildTracePointQrValue("equipment", "EQ-0042"), "https://app.example/q/firearm/" + firearm, firearm, "UNIT-12", "SN-LEGIT"]) {
  const value = identifier(v);
  console.log(JSON.stringify(v), "=> passes opaqueHandle:", opaqueHandle.test(value), opaqueHandle.test(value) ? "" : "-> HTTP 400 'This QR code is not valid.'");
}
try { buildTracePointQrValue("firearm" as never, firearm); console.log("buildTracePointQrValue('firearm') accepted at runtime (type is vehicle|equipment only)"); } catch (e) { console.log("firearm kind:", (e as Error).message); }

console.log("--- 2. Route queries executed through the real PostgresDataClient against local AWS-chain DB (arm04aws)");
const pool = new pg.Pool({ host: "127.0.0.1", port: 55491, user: "postgres", database: "arm04aws", max: 2 });
await pool.query("update public.firearms set asset_number='FA-0001' where id=$1", [firearm]);
const admin = new PostgresDataClient(pool as never, armorerA, A);
async function resolve(value: string) {
  const [vehicle, equipment, fa] = await Promise.all([
    admin.from("fleet_vehicles").select("id,unit_number,vin,status").eq("department_id", A).or(`id.eq.${value},unit_number.eq.${value},vin.eq.${value}`).maybeSingle(),
    admin.from("equipment_assets").select("id,manufacturer,model,serial_number,asset_number,lifecycle_status").eq("department_id", A).neq("lifecycle_status", "removed").or(`id.eq.${value},asset_number.eq.${value},serial_number.eq.${value}`).maybeSingle(),
    admin.from("firearms").select("id,serial_number,asset_number,is_active").eq("department_id", A).eq("is_active", true).or(`id.eq.${value},asset_number.eq.${value},serial_number.eq.${value}`).maybeSingle(),
  ]);
  if (vehicle.error || equipment.error || fa.error) return { http: 500, errors: [vehicle.error, equipment.error, fa.error].map(e => e?.code ?? null) };
  return { http: 200, body: qrDecision({ identifier: value, access: { permissions: ["manage_firearms"] as never, enabledFeatures: ["firearms"] }, vehicle: vehicle.data as never, equipment: equipment.data as never, firearm: fa.data as never }) };
}
for (const v of [firearm, "FA-0001", "SN-LEGIT"]) console.log(JSON.stringify(v), "=>", JSON.stringify(await resolve(v)));
// Minimal raw check of the root cause
try { await pool.query("select 1 from public.firearms where (id = $1 or asset_number = $1::text)", ["FA-0001"]); } catch (e) { console.log("root cause: uuid column compared to non-UUID text parameter =>", (e as { code: string }).code, (e as Error).message); }
await pool.end();
console.log("--- 3. qrDecision: unauthorized firearm is 'denied' (not 'unknown') => confirms existence; equipment has no permission check");
console.log(JSON.stringify(qrDecision({ identifier: "x", access: { permissions: [] as never, enabledFeatures: [] }, firearm: { id: firearm } })));
console.log(JSON.stringify(qrDecision({ identifier: "x", access: { permissions: [] as never, enabledFeatures: ["equipment_readiness"] }, equipment: { id: "e1", manufacturer: "Axon" } })));
