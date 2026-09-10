import type { CognitoAdminDirectory } from "./cognito-admin-core";

export type ExistingCognitoMigrationInput = {
  actorUserId: string;
  departmentId: string;
  targetUserId: string;
  siteUrl: string;
  operationId: string;
  providerUsername: string;
};

export type ExistingCognitoMigrationStore = {
  prepare(input: ExistingCognitoMigrationInput): Promise<{ email: string; fullName: string }>;
  commit(input: { operationId: string; subject: string; issuer: string }): Promise<void>;
  finish(input: { operationId: string; sent: boolean; errorCode: string | null }): Promise<void>;
};

export type ExistingCognitoMigrationDependencies = {
  store: ExistingCognitoMigrationStore;
  directory: CognitoAdminDirectory;
  issuer: string;
  sendActivation(input: {
    actorUserId: string;
    departmentId: string;
    userId: string;
    email: string;
    fullName: string;
    siteUrl: string;
  }): Promise<{ tokenId: string; expiresAt: string }>;
};

export async function migrateExistingUserToCognito(
  input: ExistingCognitoMigrationInput,
  dependencies: ExistingCognitoMigrationDependencies,
) {
  const prepared = await dependencies.store.prepare(input);
  let created;
  try {
    created = await dependencies.directory.createPending({
      username: input.providerUsername,
      email: prepared.email,
      fullName: prepared.fullName,
    });
  } catch (error) {
    await dependencies.store.finish({ operationId: input.operationId, sent: false, errorCode: "provider_create_failed" }).catch(() => undefined);
    throw error;
  }

  try {
    await dependencies.store.commit({
      operationId: input.operationId,
      subject: created.subject,
      issuer: dependencies.issuer,
    });
  } catch (error) {
    await dependencies.directory.deleteCompensation(input.providerUsername).catch(() => undefined);
    await dependencies.store.finish({ operationId: input.operationId, sent: false, errorCode: "identity_commit_failed" }).catch(() => undefined);
    throw error;
  }

  let activation;
  try {
    activation = await dependencies.sendActivation({
      actorUserId: input.actorUserId,
      departmentId: input.departmentId,
      userId: input.targetUserId,
      email: prepared.email,
      fullName: prepared.fullName,
      siteUrl: input.siteUrl,
    });
  } catch (error) {
    await dependencies.store.finish({ operationId: input.operationId, sent: false, errorCode: "activation_delivery_unconfirmed" }).catch(() => undefined);
    throw error;
  }

  await dependencies.store.finish({ operationId: input.operationId, sent: true, errorCode: null });
  return { userId: input.targetUserId, operationId: input.operationId, activation };
}
