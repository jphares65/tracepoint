import "server-only";

import { randomUUID } from "node:crypto";

import { getPostgresPool } from "@/lib/database/postgres-pool";
import { assertIdentityMutationAllowed } from "@/lib/email/notification-mode";
import { withPostgresAuthorization } from "@/lib/database/postgres-authorization-core";
import { getCognitoAdminDirectory } from "./cognito-admin";
import { CognitoDirectoryError } from "./cognito-admin-core";
import { completeAssignPassword, completePasswordReset, finishPasswordOperation, type PreparedPasswordOperation } from "./cognito-password-lifecycle-core";
import { passwordOperationContext } from "./cognito-password-operation-context";
import { isCognitoCompliantPassword } from "./password-policy";

type PasswordOperationKind = "assign_password" | "reset_password";

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

async function prepare(input: {
  operationId: string;
  kind: PasswordOperationKind;
  actorUserId: string;
  departmentId: string;
  supportMode?: boolean;
  targetUserId?: string;
  targetEmail?: string;
}) {
  return withPostgresAuthorization(getPostgresPool(), passwordOperationContext(input), async client => {
    const result = await client.query(
      "select * from tracepoint_auth.prepare_cognito_password_operation($1,$2,$3,$4,$5)",
      [input.operationId, input.kind, input.departmentId, input.targetUserId ?? null, input.targetEmail ?? null],
    ) as { rows: Array<Record<string, unknown>> };
    const row = result.rows[0];
    if (!row) throw new Error("The selected Cognito account could not be found.");
    return {
      userId: clean(row.user_id),
      providerUsername: clean(row.provider_username),
      providerSubject: clean(row.provider_subject),
      issuer: clean(row.issuer),
      email: clean(row.email).toLowerCase(),
      identityState: clean(row.identity_state) as "pending" | "active",
    } satisfies PreparedPasswordOperation;
  });
}

async function finish(operationId: string, succeeded: boolean, errorCode?: string, providerUnchanged = false) {
  const pool = getPostgresPool();
  await finishPasswordOperation((sql, values) => pool.query(sql, values), operationId, succeeded, errorCode, providerUnchanged);
}

export async function assignCognitoPassword(input: {
  actorUserId: string;
  departmentId: string;
  supportMode?: boolean;
  targetUserId: string;
  password: string;
}) {
  assertIdentityMutationAllowed();
  if (!isCognitoCompliantPassword(input.password)) {
    throw new CognitoDirectoryError("invalid_password");
  }
  const operationId = randomUUID();
  const prepared = await prepare({ ...input, operationId, kind: "assign_password" });
  return completeAssignPassword(operationId, prepared, input.password, getCognitoAdminDirectory(), finish);
}

export async function beginCognitoPasswordReset(input: {
  actorUserId: string;
  departmentId: string;
  supportMode?: boolean;
  targetEmail: string;
}) {
  assertIdentityMutationAllowed();
  const operationId = randomUUID();
  const prepared = await prepare({ ...input, operationId, kind: "reset_password" });
  return completePasswordReset(operationId, prepared, getCognitoAdminDirectory(), finish);
}
