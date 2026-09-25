import { CognitoDirectoryError, isCognitoDirectoryUsername, type CognitoAdminDirectory } from "./cognito-admin-core";

export type PendingInviteRetry = {
  user_id: string;
  operation_id: string;
  provider_username: string;
};

export function parsePendingInviteRetry(rows: unknown[]): PendingInviteRetry | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error("Pending invitation identity is ambiguous.");
  const row = rows[0] as Partial<PendingInviteRetry> | null;
  if (!row || !isCognitoDirectoryUsername(row.user_id ?? "") ||
      !isCognitoDirectoryUsername(row.operation_id ?? "") ||
      !isCognitoDirectoryUsername(row.provider_username ?? "")) {
    throw new Error("Pending invitation identity is invalid.");
  }
  return row as PendingInviteRetry;
}

// Both aliases must be absent in the dedicated pool before the existing
// provider username is retried. Any ambiguous provider error fails closed.
export async function assertPendingInviteAbsentInCognito(
  directory: Pick<CognitoAdminDirectory, "get">,
  email: string,
  candidate: PendingInviteRetry,
): Promise<void> {
  for (const lookup of [email, candidate.provider_username]) {
    try {
      await directory.get(lookup);
      throw new Error("Pending invitation already has a provider identity.");
    } catch (error) {
      if (error instanceof CognitoDirectoryError && error.code === "not_found") continue;
      throw error;
    }
  }
}
