export type MembershipLifecycleInput = {
  operationId: string;
  actorUserId: string;
  departmentId: string;
  targetUserId: string;
  active: boolean;
};

export type PreparedMembershipLifecycle = { providerUsername: string; shouldChangeProvider: boolean };

export interface MembershipLifecycleStore {
  prepare(input: MembershipLifecycleInput): Promise<PreparedMembershipLifecycle>;
  finish(operationId: string, succeeded: boolean, errorCode?: string): Promise<void>;
}

export interface MembershipLifecycleDirectory {
  enable(username: string): Promise<void>;
  disable(username: string): Promise<void>;
  globalSignOut(username: string): Promise<void>;
}

export async function applyCognitoMembershipLifecycle(
  store: MembershipLifecycleStore,
  directory: MembershipLifecycleDirectory,
  input: MembershipLifecycleInput,
) {
  const prepared = await store.prepare(input);
  try {
    if (prepared.shouldChangeProvider) {
      if (input.active) await directory.enable(prepared.providerUsername);
      else {
        await directory.globalSignOut(prepared.providerUsername);
        await directory.disable(prepared.providerUsername);
      }
    }
    await store.finish(input.operationId, true);
    return { operationId: input.operationId, providerChanged: prepared.shouldChangeProvider };
  } catch {
    await store.finish(input.operationId, false, "provider_or_commit_failed").catch(() => undefined);
    throw new Error("Cognito membership lifecycle could not be completed safely.");
  }
}
