import "server-only";

import { randomUUID } from "node:crypto";

import { getPostgresPool } from "@/lib/database/postgres-pool";
import { withPostgresAuthorization } from "@/lib/database/postgres-authorization-core";
import { getCognitoAdminDirectory } from "./cognito-admin";
import { CognitoDirectoryError, type CognitoDirectoryUser } from "./cognito-admin-core";
import { isCognitoCompliantPassword } from "./password-policy";

type PasswordOperationKind = "assign_password" | "reset_password";
type PreparedPasswordOperation = {
  userId: string;
  providerUsername: string;
  providerSubject: string;
  issuer: string;
  email: string;
  identityState: "pending" | "active";
};

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

async function prepare(input: {
  operationId: string;
  kind: PasswordOperationKind;
  actorUserId: string;
  departmentId: string;
  targetUserId?: string;
  targetEmail?: string;
}) {
  return withPostgresAuthorization(getPostgresPool(), { subjectId: input.actorUserId, departmentId: input.departmentId }, async client => {
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

async function finish(operationId: string, succeeded: boolean, errorCode?: string) {
  await getPostgresPool().query(
    "select tracepoint_auth.finish_cognito_password_operation($1,$2,$3)",
    [operationId, succeeded, errorCode ?? null],
  );
}

function safeCode(error: unknown) {
  return error instanceof CognitoDirectoryError ? error.code : "provider_unavailable";
}

function assertDirectoryMatch(prepared: PreparedPasswordOperation, actual: CognitoDirectoryUser) {
  if (!actual.enabled || actual.username !== prepared.providerUsername || actual.subject !== prepared.providerSubject ||
      actual.email.toLowerCase() !== prepared.email) {
    throw new CognitoDirectoryError("conflict");
  }
}

export async function assignCognitoPassword(input: {
  actorUserId: string;
  departmentId: string;
  targetUserId: string;
  password: string;
}) {
  if (!isCognitoCompliantPassword(input.password)) {
    throw new CognitoDirectoryError("invalid_password");
  }
  const operationId = randomUUID();
  const prepared = await prepare({ ...input, operationId, kind: "assign_password" });
  const directory = getCognitoAdminDirectory();
  try {
    assertDirectoryMatch(prepared, await directory.get(prepared.providerUsername));
    await directory.setPermanentPassword(prepared.providerUsername, input.password);
    if (prepared.identityState === "pending") await directory.markEmailVerified(prepared.providerUsername);
    await directory.globalSignOut(prepared.providerUsername);
    await finish(operationId, true);
    return prepared;
  } catch (error) {
    await finish(operationId, false, safeCode(error)).catch(() => undefined);
    throw error;
  }
}

export async function beginCognitoPasswordReset(input: {
  actorUserId: string;
  departmentId: string;
  targetEmail: string;
}) {
  const operationId = randomUUID();
  const prepared = await prepare({ ...input, operationId, kind: "reset_password" });
  const directory = getCognitoAdminDirectory();
  try {
    assertDirectoryMatch(prepared, await directory.get(prepared.providerUsername));
    await directory.globalSignOut(prepared.providerUsername);
    await directory.beginPasswordReset(prepared.providerUsername);
    await finish(operationId, true);
    return prepared;
  } catch (error) {
    await finish(operationId, false, safeCode(error)).catch(() => undefined);
    throw error;
  }
}
