import "server-only";

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
  // Stable UUIDs make retries converge on the same lifecycle operation and
  // Cognito username after any ambiguous provider/database response.
  const operationId = input.targetUserId;
  const providerUsername = input.targetUserId;
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

export async function resumeExistingCognitoUserActivation(input: {
  actorUserId: string;
  departmentId: string;
  targetUserId: string;
  siteUrl: string;
}) {
  const pool = getPostgresPool();
  const config = parseCognitoRuntimeConfiguration(process.env);
  const issuer = `https://cognito-idp.${config.verification.region}.amazonaws.com/${config.verification.userPoolId}`;
  const result = await pool.query(
    `select op.id,op.state,op.provider_subject,op.provider_username,p.email,p.full_name,l.issuer,l.subject,l.state as link_state
     from public.authentication_lifecycle_operations op
     join public.profiles p on p.id=op.tracepoint_user_id
     join public.authentication_identity_links l on l.provider='cognito' and l.tracepoint_user_id=op.tracepoint_user_id
     where op.id=$1 and op.operation_kind='migrate_identity' and op.tracepoint_user_id=$1 and op.department_id=$2`,
    [input.targetUserId, input.departmentId],
  );
  const row = result.rows[0];
  if (result.rowCount !== 1 || row.issuer !== issuer || row.subject !== row.provider_subject ||
      row.provider_username !== input.targetUserId || row.link_state !== "pending" ||
      !["provider_succeeded", "compensation_required", "committed"].includes(row.state)) {
    throw new Error("Existing Cognito migration cannot be resumed safely.");
  }
  if (row.state === "committed") return { userId: input.targetUserId, operationId: input.targetUserId, alreadyDelivered: true };
  if (row.state === "compensation_required") {
    await pool.query("select tracepoint_auth.commit_existing_cognito_migration($1,$2,$3)", [input.targetUserId, row.subject, issuer]);
  }
  const activation = await issueActivationEmail({ actorUserId: input.actorUserId, departmentId: input.departmentId, userId: input.targetUserId, email: row.email, fullName: row.full_name, siteUrl: input.siteUrl });
  await pool.query("select tracepoint_auth.finish_existing_cognito_migration($1,true,null)", [input.targetUserId]);
  return { userId: input.targetUserId, operationId: input.targetUserId, activation, alreadyDelivered: false };
}
