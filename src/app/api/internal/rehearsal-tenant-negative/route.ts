import { NextRequest } from "next/server";

import { resolveServerAccess } from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

// Temporary, read-only cutover proof. This route is inert outside the exact
// isolated rehearsal origin/pool and the two synthetic Officer identities.
const HOST = "shadow-rehearsal.tracepointhq.com";
const POOL = "us-east-1_wZwXHpznS";
const ACTORS = {
  "jphares+montville-rehearsal@tracepointhq.com": {
    own: "1d0e2994-4224-4237-8328-71020ba20027",
    foreign: "d01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0",
    ownFleet: "0692d617-a56d-41ce-ad72-9da4011a9195",
    foreignFleet: "c95eba4f-ecbb-4934-828e-e035416acd43",
    ownFirearm: "00f65a31-06c2-4a47-aeb4-4422168cebb4",
    foreignFirearm: "03b16c7b-14e6-4473-aaba-6853cd4c581d",
    ownEquipment: "01a42022-10f3-4822-b744-fb9505236807",
    foreignEquipment: "43d77866-7164-4a43-a678-4fba97402f1b",
    foreignNotification: "35688583-5408-4898-b2d6-f4e36e7c437a",
    ownPatch: "1d0e2994-4224-4237-8328-71020ba20027/patch-1787431778595.jpg",
    foreignPatch: "d01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0/patch-1782439034425.png",
  },
  "jphares@tracepointhq.com": {
    own: "d01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0",
    foreign: "1d0e2994-4224-4237-8328-71020ba20027",
    ownFleet: "c95eba4f-ecbb-4934-828e-e035416acd43",
    foreignFleet: "0692d617-a56d-41ce-ad72-9da4011a9195",
    ownFirearm: "03b16c7b-14e6-4473-aaba-6853cd4c581d",
    foreignFirearm: "00f65a31-06c2-4a47-aeb4-4422168cebb4",
    ownEquipment: "43d77866-7164-4a43-a678-4fba97402f1b",
    foreignEquipment: "01a42022-10f3-4822-b744-fb9505236807",
    foreignNotification: "042f27c9-e630-415e-abc4-95aa651cd88a",
    ownPatch: "d01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0/patch-1782439034425.png",
    foreignPatch: "1d0e2994-4224-4237-8328-71020ba20027/patch-1787431778595.jpg",
  },
} as const;

type Check = { route: string; status: number; expected: string; pass: boolean };

function page(actor: string, checks: Check[]) {
  const rows = checks.map(({ route, status, expected, pass }) =>
    `<tr><td>${route}</td><td>${status}</td><td>${expected}</td><td>${pass ? "PASS" : "FAIL"}</td></tr>`,
  ).join("");
  const result = checks.length > 0 && checks.every((check) => check.pass) ? "PASS" : "FAIL";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Rehearsal tenant-negative proof</title><body><h1>Rehearsal tenant-negative proof: ${result}</h1><p>Actor: ${actor}</p><table border="1"><thead><tr><th>Route</th><th>HTTP</th><th>Expected</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export async function GET(request: NextRequest) {
  if (
    process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE !== "aws-native" ||
    process.env.NEXT_PUBLIC_SITE_URL !== `https://${HOST}` ||
    process.env.TRACEPOINT_COGNITO_USER_POOL_ID !== POOL ||
    request.headers.get("host") !== HOST ||
    request.headers.get("x-forwarded-host") !== HOST ||
    request.headers.get("x-forwarded-proto") !== "https"
  ) return new Response(null, { status: 404 });

  const access = await resolveServerAccess();
  if (!access.ok) return new Response(null, { status: access.status });
  const actor = access.context.email.toLowerCase();
  const target = ACTORS[actor as keyof typeof ACTORS];
  if (!target || access.context.departmentId !== target.own ||
      access.context.roleCodes.length !== 1 || access.context.roleCodes[0] !== "officer") {
    return new Response(null, { status: 403 });
  }
  const sessionCookie = request.headers.get("cookie");
  if (!sessionCookie) return new Response(null, { status: 401 });

  // The authenticated cookie never leaves this process/container, is never
  // logged, and is forwarded only to the same app over loopback.
  async function probe(path: string, body?: Record<string, unknown>) {
    const headers = new Headers({
      cookie: sessionCookie!,
      host: HOST,
      "x-forwarded-host": HOST,
      "x-forwarded-proto": "https",
    });
    if (body) headers.set("content-type", "application/json");
    const response = await fetch(`http://127.0.0.1:3000${path}`, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return response;
  }

  const checks: Check[] = [];
  async function status(route: string, path: string, expected: number, body?: Record<string, unknown>) {
    try {
      const response = await probe(path, body);
      checks.push({ route, status: response.status, expected: String(expected), pass: response.status === expected });
    } catch {
      checks.push({ route, status: 0, expected: String(expected), pass: false });
    }
  }

  await status("access/own", "/api/access", 200);
  await status("fleet/own", `/api/fleet/vehicles/${target.ownFleet}`, 200);
  await status("fleet/foreign", `/api/fleet/vehicles/${target.foreignFleet}`, 404);
  await status("firearm/own", `/api/armory/firearms/${target.ownFirearm}/attachments`, 200);
  await status("firearm/foreign", `/api/armory/firearms/${target.foreignFirearm}/attachments`, 404);
  // Readington currently has no active equipment asset; a same-tenant custody
  // positive control would be invalid there. The list contract must still be
  // available and must not contain the known foreign row.
  if (actor !== "jphares@tracepointhq.com") {
    await status("equipment/own", `/api/equipment/custody?identifier=${target.ownEquipment}`, 200);
  }
  await status("equipment/foreign", `/api/equipment/custody?identifier=${target.foreignEquipment}`, 404);
  try {
    const response = await probe("/api/equipment/assets");
    const body = response.status === 200 ? await response.text() : "";
    checks.push({
      route: "equipment/list-foreign-absent", status: response.status,
      expected: "200, foreign asset absent",
      pass: response.status === 200 && !body.includes(target.foreignEquipment),
    });
  } catch {
    checks.push({ route: "equipment/list-foreign-absent", status: 0, expected: "200, foreign asset absent", pass: false });
  }
  await status("settings/own", `/api/settings/visual-configuration?departmentId=${target.own}`, 200);
  await status("settings/foreign", `/api/settings/visual-configuration?departmentId=${target.foreign}`, 403);
  await status("admin/foreign", `/api/settings/onboarding/personnel-directory?departmentId=${target.foreign}`, 403);
  await status("settings-data/foreign", "/api/settings/data", 403, {
    table: "departments", operation: "select", fields: "id", filters: [{ kind: "eq", column: "id", value: target.foreign }],
  });
  await status("object/own", `/api/settings/department-patch?path=${encodeURIComponent(target.ownPatch)}`, 307);
  await status("object/foreign", `/api/settings/department-patch?path=${encodeURIComponent(target.foreignPatch)}`, 404);
  await status("audit/officer", "/api/settings/audit-log?limit=1", 403);
  try {
    const response = await probe("/api/notifications");
    const body = response.status === 200 ? await response.text() : "";
    checks.push({
      route: "notifications/foreign-absent", status: response.status,
      expected: "200, foreign event absent",
      pass: response.status === 200 && !body.includes(target.foreignNotification),
    });
  } catch {
    checks.push({ route: "notifications/foreign-absent", status: 0, expected: "200, foreign event absent", pass: false });
  }

  const outcome = checks.every((check) => check.pass) ? "PASS" : "FAIL";
  console.info(JSON.stringify({ event: "REHEARSAL_TENANT_HTTP_NEGATIVE", actor: actor === "jphares@tracepointhq.com" ? "readington_officer" : "montville_officer", outcome, checks }));
  return new Response(page(actor === "jphares@tracepointhq.com" ? "Readington Officer" : "Montville Officer", checks), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}
