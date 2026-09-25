import "server-only";

import { getPostgresPool } from "@/lib/database/postgres-pool";
import { withPostgresAuthorization } from "@/lib/database/postgres-authorization-core";
import { assertIdentityMutationAllowed } from "@/lib/email/notification-mode";
import { getCognitoMigrationDirectory } from "./cognito-admin";
import { parseCognitoTargetConfiguration } from "./cognito-runtime-configuration-core";

export async function resendPendingCognitoActivation(input: {
  actorUserId: string;
  departmentId: string;
  targetUserId: string;
}) {
  assertIdentityMutationAllowed();
  const pool = getPostgresPool();
  const row = await withPostgresAuthorization(pool, {
    subjectId: input.actorUserId,
    departmentId: input.departmentId,
  }, async client => {
    const result = await client.query(
      "select * from tracepoint_auth.prepare_cognito_activation_resend($1,$2)",
      [input.departmentId, input.targetUserId],
    ) as { rowCount: number | null; rows: Array<{ email: string; provider_subject: string; issuer: string }> };
    if (result.rowCount !== 1) throw new Error("Pending Cognito activation is unavailable.");
    return result.rows[0] as { email: string; provider_subject: string; issuer: string };
  });
  const config = parseCognitoTargetConfiguration(process.env);
  const expectedIssuer = `https://cognito-idp.${config.verification.region}.amazonaws.com/${config.verification.userPoolId}`;
  if (row.issuer !== expectedIssuer) throw new Error("Cognito activation pool mismatch.");
  await getCognitoMigrationDirectory().resendInvitation(row.email, row.provider_subject);
  await withPostgresAuthorization(pool, {
    subjectId: input.actorUserId,
    departmentId: input.departmentId,
  }, async client => {
    await client.query("select tracepoint_auth.finish_cognito_activation_resend($1,$2,$3)",
      [input.departmentId, input.targetUserId, row.provider_subject]);
  });
}
