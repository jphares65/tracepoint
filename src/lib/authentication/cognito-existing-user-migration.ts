import "server-only";

import { randomUUID } from "node:crypto";

import { getPostgresPool } from "@/lib/database/postgres-pool";
import { withPostgresAuthorization } from "@/lib/database/postgres-authorization-core";
import { issueActivationEmail } from "@/lib/tracepoint/activation";

import { getCognitoAdminDirectory } from "./cognito-admin";
import { migrateExistingUserToCognito } from "./cognito-existing-user-migration-core";
import { parseCognitoRuntimeConfiguration } from "./cognito-runtime-configuration-core";

export async function provisionExistingCognitoUser(input: {
  actorUserId: string;
  departmentId: string;
  targetUserId: string;
  siteUrl: string;
}) {
  const pool = getPostgresPool();
  const operationId = randomUUID();
  const providerUsername = randomUUID();
  const config = parseCognitoRuntimeConfiguration(process.env);
  const issuer = `https://cognito-idp.${config.verification.region}.amazonaws.com/${config.verification.userPoolId}`;

  return migrateExistingUserToCognito(
    { ...input, operationId, providerUsername },
    {
      directory: getCognitoAdminDirectory(),
      issuer,
      sendActivation: issueActivationEmail,
      store: {
        async prepare(value) {
          return withPostgresAuthorization(
            pool,
            { subjectId: value.actorUserId, departmentId: value.departmentId },
            async client => {
              const result = await client.query(
                "select * from tracepoint_auth.prepare_existing_cognito_migration($1,$2,$3,$4)",
                [value.operationId, value.providerUsername, value.departmentId, value.targetUserId],
              ) as { rows: Array<{ email?: unknown; full_name?: unknown }> };
              const row = result.rows[0];
              if (!row?.email || !row?.full_name) throw new Error("Identity migration preparation failed.");
              return { email: String(row.email), fullName: String(row.full_name) };
            },
          );
        },
        async commit(value) {
          await pool.query("select tracepoint_auth.commit_existing_cognito_migration($1,$2,$3)", [value.operationId, value.subject, value.issuer]);
        },
        async finish(value) {
          await pool.query("select tracepoint_auth.finish_existing_cognito_migration($1,$2,$3)", [value.operationId, value.sent, value.errorCode]);
        },
      },
    },
  );
}
