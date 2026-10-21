import { assertCognitoPasswordResetReady, CognitoDirectoryError, type CognitoAdminDirectory, type CognitoDirectoryUser } from "./cognito-admin-core";

export type PreparedPasswordOperation = {
  userId: string;
  providerUsername: string;
  providerSubject: string;
  issuer: string;
  email: string;
  identityState: "pending" | "active";
};

export type FinishPasswordOperation = (operationId: string, succeeded: boolean, errorCode?: string, providerUnchanged?: boolean) => Promise<void>;
type Query = (sql: string, values: unknown[]) => Promise<unknown>;

function safeCode(error: unknown) {
  return error instanceof CognitoDirectoryError ? error.code : "provider_unavailable";
}

function assertDirectoryMatch(prepared: PreparedPasswordOperation, actual: CognitoDirectoryUser) {
  if (!actual.enabled || actual.username !== prepared.providerUsername || actual.subject !== prepared.providerSubject ||
      actual.email.toLowerCase() !== prepared.email) {
    throw new CognitoDirectoryError("conflict");
  }
}

// Only a failure before the first Cognito write proves Cognito unchanged. The
// flag is set before each write is attempted, so a write that may have reached
// Cognito keeps the operation uncertain and blocked until it is resolved.
export async function completeAssignPassword(
  operationId: string,
  prepared: PreparedPasswordOperation,
  password: string,
  directory: Pick<CognitoAdminDirectory, "get" | "setPermanentPassword" | "globalSignOut">,
  finish: FinishPasswordOperation,
) {
  let writeAttempted = false;
  try {
    assertDirectoryMatch(prepared, await directory.get(prepared.providerUsername));
    writeAttempted = true;
    await directory.setPermanentPassword(prepared.providerUsername, password);
    await directory.globalSignOut(prepared.providerUsername);
    await finish(operationId, true);
    return prepared;
  } catch (error) {
    await finish(operationId, false, safeCode(error), !writeAttempted).catch(() => undefined);
    throw error;
  }
}

export async function completePasswordReset(
  operationId: string,
  prepared: PreparedPasswordOperation,
  directory: Pick<CognitoAdminDirectory, "get" | "globalSignOut" | "beginPasswordReset">,
  finish: FinishPasswordOperation,
) {
  let writeAttempted = false;
  try {
    const actual = await directory.get(prepared.providerUsername);
    assertDirectoryMatch(prepared, actual);
    assertCognitoPasswordResetReady(actual);
    writeAttempted = true;
    await directory.globalSignOut(prepared.providerUsername);
    await directory.beginPasswordReset(prepared.providerUsername);
    await finish(operationId, true);
    return prepared;
  } catch (error) {
    await finish(operationId, false, safeCode(error), !writeAttempted).catch(() => undefined);
    throw error;
  }
}

// The four-argument finish exists only after migration 040. Before it, a
// pre-write failure is recorded as before, which keeps it blocked until an
// owner resolves it; every other call keeps the original three arguments.
export async function finishPasswordOperation(
  query: Query,
  operationId: string,
  succeeded: boolean,
  errorCode?: string,
  providerUnchanged = false,
) {
  if (succeeded || !providerUnchanged) {
    await query("select tracepoint_auth.finish_cognito_password_operation($1,$2,$3)", [operationId, succeeded, errorCode ?? null]);
    return;
  }
  try {
    await query("select tracepoint_auth.finish_cognito_password_operation($1,$2,$3,$4)", [operationId, false, errorCode ?? null, true]);
  } catch (error) {
    if ((error as { code?: unknown })?.code !== "42883") throw error;
    await query("select tracepoint_auth.finish_cognito_password_operation($1,$2,$3)", [operationId, false, errorCode ?? null]);
  }
}
