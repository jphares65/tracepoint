import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";

import { unexpectedErrorResponse } from "../tracepoint/api-errors.ts";
import { cognitoInviteRefusal, EXISTING_MEMBER_INVITE, findAuthUserByEmail } from "./invite-core.ts";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const users = (count: number, perPage: number) => (page: number) => Array.from(
  { length: Math.max(0, Math.min(perPage, count - (page - 1) * perPage)) },
  (_, index) => ({ id: `u${(page - 1) * perPage + index}`, email: `user${(page - 1) * perPage + index}@example.test` }),
);

test("ADM-19: the account lookup reads every page, not only the first 2,000 users", async () => {
  const listed = users(2500, 100);
  const pages: number[] = [];
  const list = async (page: number) => { pages.push(page); return { data: { users: listed(page) }, error: null }; };
  assert.equal((await findAuthUserByEmail(list, "USER2345@example.test"))?.id, "u2345");
  assert.equal(pages.at(-1), 24);
  pages.length = 0;
  assert.equal(await findAuthUserByEmail(list, "absent@example.test"), null);
  assert.equal(pages.at(-1), 26);
  await assert.rejects(findAuthUserByEmail(async () => ({ data: null, error: new Error("listing failed") }), "x@example.test"), /listing failed/);
});

test("ADM-19: re-inviting an existing member changes nothing and says so", () => {
  const route = source("../../app/api/settings/users/invite/route.ts");
  assert.doesNotMatch(route, /page <= 20/);
  assert.match(route, /findAuthUserByEmail\(\s*\(page, perPage\) => admin\.auth\.admin\.listUsers\(\{ page, perPage \}\),\s*email,\s*\)/);
  const existing = route.indexOf("if (existingMembership) {");
  assert.ok(existing > 0 && existing < route.indexOf('.from("department_memberships")\n      .upsert('));
  assert.ok(existing < route.indexOf('from("profiles").upsert('));
  assert.match(route, /if \(existingMembership\) \{\s*return NextResponse\.json\(\s*\{ error: EXISTING_MEMBER_INVITE\.error \},\s*\{ status: EXISTING_MEMBER_INVITE\.status \},/);
  assert.match(route, /\{ onConflict: "id", ignoreDuplicates: !invitationSent \}/);
  assert.equal(EXISTING_MEMBER_INVITE.status, 409);
  for (const path of ["../../app/api/settings/onboarding/personnel/route.ts", "../../app/api/settings/users/password-reset/route.ts", "../ai-importer/server/execution.ts"]) {
    assert.doesNotMatch(source(path), /page <= 20/, path);
    assert.match(source(path), /findAuthUserByEmail\(/, path);
  }
});

test("ADM-19/ADM-32: Cognito invite refusals map to clear statuses; other errors map to nothing", () => {
  assert.deepEqual(cognitoInviteRefusal({ code: "23505", message: "explicit existing identity selection required" })?.status, 409);
  assert.equal(cognitoInviteRefusal({ code: "42501", message: "administrator assignment forbidden" })?.status, 403);
  assert.equal(cognitoInviteRefusal({ code: "22023", message: "invalid roles" })?.status, 400);
  assert.equal(cognitoInviteRefusal(new Error('relation "public.profiles" does not exist')), null);
  assert.equal(cognitoInviteRefusal({ message: "toString" }), null);
  assert.equal(cognitoInviteRefusal(null), null);
});

test("ADM-32: an unexpected failure returns a fixed message with the same status and shape, and logs the detail", async () => {
  const logged = mock.method(console, "error", () => {});
  try {
    const detail = new Error('duplicate key value violates unique constraint "profiles_pkey"');
    const response = unexpectedErrorResponse("User invite", detail, "The user could not be added.");
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "The user could not be added." });
    assert.deepEqual(logged.mock.calls[0].arguments, ["User invite failed", detail]);
  } finally {
    logged.mock.restore();
  }
});

test("ADM-32: admin routes no longer return raw database or provider messages", () => {
  const routes = [
    "../../app/api/settings/users/invite/route.ts", "../../app/api/settings/users/activation/route.ts",
    "../../app/api/settings/users/password-reset/route.ts", "../../app/api/settings/users/assign-password/route.ts",
    "../../app/api/settings/onboarding/personnel/route.ts", "../../app/api/platform/agency-user-administrator/route.ts",
    "../../app/api/super-admin/route.ts", "../../app/api/platform/support-mode/route.ts",
  ];
  for (const path of routes) {
    const route = source(path);
    assert.doesNotMatch(route, /error instanceof Error\s*\?\s*error\.message/, path);
    assert.doesNotMatch(route, /\{ error: \w+(\.error)?\.message \}/, path);
    assert.match(route, /unexpectedErrorResponse\(/, path);
  }
  const invite = source("../../app/api/settings/users/invite/route.ts");
  assert.match(invite, /const refusal = cognitoInviteRefusal\(error\);\s*if \(refusal\) return NextResponse\.json\(\{ error: refusal\.error \}, \{ status: refusal\.status \}\);\s*return unexpectedErrorResponse\("User invite", error, "The user could not be added\."\);/);
});
