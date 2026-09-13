import type { CognitoAdminDirectory } from "./cognito-admin-core";

export type ExceptionalIdentityDisposition = "inactive-disabled" | "platform-administrator";

export type ExceptionalIdentityMigrationInput = {
  targetUserId: string;
  providerUsername: string;
  disposition: ExceptionalIdentityDisposition;
};

export type ExceptionalIdentityMigrationStore = {
  prepare(input: ExceptionalIdentityMigrationInput): Promise<{ email: string; fullName: string }>;
  commit(input: ExceptionalIdentityMigrationInput & { issuer: string; subject: string }): Promise<void>;
};

export async function migrateExceptionalUserToCognito(
  input: ExceptionalIdentityMigrationInput,
  dependencies: { directory: CognitoAdminDirectory; issuer: string; store: ExceptionalIdentityMigrationStore },
) {
  const prepared = await dependencies.store.prepare(input);
  let provider;
  try {
    provider = await dependencies.directory.createPending({
      username: input.providerUsername,
      email: prepared.email,
      fullName: prepared.fullName,
    });
  } catch (error) {
    try { provider = await dependencies.directory.get(input.providerUsername); }
    catch { throw error; }
  }
  if (provider.username !== input.providerUsername ||
      provider.email.trim().toLowerCase() !== prepared.email.trim().toLowerCase() ||
      provider.status !== "FORCE_CHANGE_PASSWORD") {
    throw new Error("Exceptional Cognito identity reconciliation failed.");
  }
  if (input.disposition === "inactive-disabled") {
    await dependencies.directory.disable(input.providerUsername);
    provider = await dependencies.directory.get(input.providerUsername);
    if (provider.enabled || provider.status !== "FORCE_CHANGE_PASSWORD" || provider.subject === "") {
      throw new Error("Inactive Cognito identity could not be proven disabled.");
    }
  } else {
    if (!provider.enabled) throw new Error("Platform administrator Cognito identity is disabled.");
    await dependencies.directory.markEmailVerified(input.providerUsername);
    provider = await dependencies.directory.get(input.providerUsername);
    if (!provider.enabled || provider.status !== "FORCE_CHANGE_PASSWORD" || provider.emailVerified !== true) {
      throw new Error("Platform administrator Cognito recovery state could not be established.");
    }
  }
  await dependencies.store.commit({ ...input, issuer: dependencies.issuer, subject: provider.subject });
  return {
    userId: input.targetUserId,
    disposition: input.disposition,
    applicationLinkState: input.disposition === "inactive-disabled" ? "revoked" : "pending",
    providerEnabled: provider.enabled,
    recoveryReady: input.disposition === "platform-administrator",
    activationEmailSent: false,
  } as const;
}
