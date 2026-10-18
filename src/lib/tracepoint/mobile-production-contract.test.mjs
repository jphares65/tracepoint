import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePaths = [
  "src/app/api/mobile/qr/resolve/route.ts",
  "src/app/api/mobile/firearms/route.ts",
  "src/app/api/mobile/inventory/route.ts",
  "src/app/api/mobile/inbox/route.ts",
  "src/app/api/mobile/range-days/route.ts",
  "src/app/api/mobile/range-days/[rangeDayId]/route.ts",
  "src/app/api/mobile/range-days/[rangeDayId]/attendance/route.ts",
  "src/app/api/mobile/range-workspace/route.ts",
  "src/app/api/mobile/drill-documents/[documentId]/view/route.ts",
];

test("production mobile endpoints resolve bearer identity before touching tenant data", async () => {
  for (const path of routePaths) {
    const source = await readFile(path, "utf8");
    assert.match(source, /resolveServerAccess\(request\)/, `${path} must resolve the request auth`);
    assert.match(source, /accessFailureResponse\(resolved\)/, `${path} must fail closed on auth denial`);
    assert.match(source, /Cache-Control.*no-store|headers: noStore/, `${path} must not cache tenant data`);
  }
});

test("QR, Firearms, inventory, inbox, and Range Day reads are bound to the server-selected agency", async () => {
  const [qr, firearms, inventory, inbox, rangeDays, rangeDay, attendance, workspace, drill] = await Promise.all(
    routePaths.map((path) => readFile(path, "utf8")),
  );
  assert.match(qr, /from\("fleet_vehicles"\)[\s\S]*?\.eq\("department_id", departmentId\)/);
  assert.match(qr, /from\("equipment_assets"\)[\s\S]*?\.eq\("department_id", departmentId\)/);
  assert.match(qr, /from\("firearms"\)[\s\S]*?\.eq\("department_id", departmentId\)/);
  assert.match(qr, /from\("inventory_items"\)[\s\S]*?\.eq\("department_id", departmentId\)/);
  assert.match(firearms, /ctx\.departmentId/);
  assert.match(inventory, /\.eq\("department_id", ctx\.departmentId\)/);
  assert.match(inbox, /\.eq\("department_id", departmentId\)[\s\S]*?\.eq\("user_id", userId\)/);
  assert.match(rangeDays, /createRangeReadRepository\(resolved\.context\.admin, resolved\.context\.departmentId\)/);
  assert.match(rangeDay, /createRangeReadRepository\(resolved\.context\.admin, resolved\.context\.departmentId\)/);
  assert.match(workspace, /\.eq\("department_id", resolved\.context\.departmentId\)/);
  assert.match(attendance, /\.eq\("department_id", ctx\.departmentId\)/);
  assert.match(drill, /\.eq\("department_id", departmentId\)/);
});

test("mobile bearer trust stays limited to the dedicated public client and mobile routes", async () => {
  const config = await readFile("src/lib/authentication/cognito-runtime-configuration-core.ts", "utf8");
  const access = await readFile("src/lib/tracepoint/server-access.ts", "utf8");
  assert.match(config, /parseCognitoMobileTargetConfiguration/);
  assert.match(config, /clientId === target\.verification\.clientId/);
  assert.match(config, /trustedClientIds: \[clientId\]/);
  assert.match(access, /isDedicatedMobileApiPath\(request\.url\)/);
  assert.match(access, /if \(\(await headers\(\)\)\.has\("authorization"\)\)[\s\S]*?status: 401/);
});
