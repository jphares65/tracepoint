// ADM-01 (Supabase bridge path): reproduce "imported user cannot activate" with an in-memory
// fake of the Supabase admin client. Only @/lib/supabase/admin is mocked; activation.ts is the real code.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mock, test } from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const TOKEN_ID = "6f1c2e4a-8b7d-4c3e-9a1b-2c3d4e5f6a7b";
const SECRET = "S".repeat(43);
const hash = createHash("sha256").update(SECRET, "utf8").digest("hex");

// What onboarding/personnel/route.ts:204-211 (bridge) creates: email_confirm:true -> email_confirmed_at set.
let authUser: Record<string, unknown> = {};

function query(rows: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "is", "neq", "in", "gt", "update", "insert"]) chain[k] = () => chain;
  chain.maybeSingle = async () => ({ data: rows, error: null });
  return chain;
}

mock.module(pathToFileURL(path.resolve("src/lib/supabase/admin.ts")).href, {
  namedExports: {
    createAdminClient: () => ({
      from(table: string) {
        if (table === "user_activation_tokens") return query({ id: TOKEN_ID, department_id: "d", user_id: "u", token_hash: hash, expires_at: new Date(Date.now() + 86400000).toISOString(), used_at: null, revoked_at: null });
        if (table === "department_memberships") return query({ department_id: "d", user_id: "u", is_active: true, activation_status: "activation_sent" });
        throw new Error("unexpected table " + table);
      },
      auth: { admin: { getUserById: async () => ({ data: { user: authUser }, error: null }) } },
    }),
  },
});

test("ADM-01/bridge: imported user (email_confirm:true) is rejected by validateActivationToken", async () => {
  delete process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE;
  const { validateActivationToken } = await import("@/lib/tracepoint/activation");
  authUser = { id: "u", email: "officer@agency.gov", email_confirmed_at: "2026-10-20T00:00:00Z", user_metadata: { onboarding_status: "pending_activation", full_name: "Imported Officer" } };
  await assert.rejects(validateActivationToken(`${TOKEN_ID}.${SECRET}`), /This account no longer requires activation\./);
});

test("ADM-01/bridge control: invited user (email_confirm:false) passes validateActivationToken", async () => {
  const { validateActivationToken } = await import("@/lib/tracepoint/activation");
  authUser = { id: "u", email: "officer@agency.gov", email_confirmed_at: null, user_metadata: { onboarding_status: "pending_activation", full_name: "Invited Officer" } };
  const result = await validateActivationToken(`${TOKEN_ID}.${SECRET}`);
  assert.equal(result.email, "officer@agency.gov");
});
