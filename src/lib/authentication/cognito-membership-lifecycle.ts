import "server-only";
import { randomUUID } from "node:crypto";
import { getPostgresPool } from "@/lib/database/postgres-pool";
import { withPostgresAuthorization, type PostgresAuthorizationClient } from "@/lib/database/postgres-authorization-core";
import { getCognitoAdminDirectory } from "./cognito-admin";
import { applyCognitoMembershipLifecycle, type MembershipLifecycleInput, type MembershipLifecycleStore } from "./cognito-membership-lifecycle-core";
import { assertIdentityMutationAllowed } from "@/lib/email/notification-mode";
import { cognitoInviteAuthorizationContext } from "./cognito-invite-authorization-context";

// withinPrepare runs in the preparation transaction: if it fails, the
// preparation (membership change and session revocation) rolls back with it.
export async function setCognitoMembershipActive(
  input: Omit<MembershipLifecycleInput, "operationId"> & { supportMode?: boolean },
  withinPrepare?: (client: PostgresAuthorizationClient) => Promise<void>,
) {
  assertIdentityMutationAllowed();
  const pool = getPostgresPool();
  const store: MembershipLifecycleStore = {
    async prepare(value) {
      return withPostgresAuthorization(pool, cognitoInviteAuthorizationContext({ ...value, supportMode: input.supportMode }), async client => {
        const result = (await client.query(
          "select * from tracepoint_auth.prepare_cognito_membership_operation($1,$2,$3,$4)",
          [value.operationId, value.active ? "enable" : "disable", value.departmentId, value.targetUserId],
        )) as { rows: Array<{ provider_username?: unknown; should_change_provider?: unknown }> };
        const row = result.rows[0];
        if (!row?.provider_username) throw new Error("Cognito membership preparation failed.");
        await withinPrepare?.(client);
        return { providerUsername: String(row.provider_username), shouldChangeProvider: row.should_change_provider === true };
      });
    },
    async finish(operationId, succeeded, errorCode) {
      await pool.query("select tracepoint_auth.finish_cognito_membership_operation($1,$2,$3)", [operationId, succeeded, errorCode ?? null]);
    },
  };
  return applyCognitoMembershipLifecycle(store, getCognitoAdminDirectory(), { ...input, operationId: randomUUID() });
}
