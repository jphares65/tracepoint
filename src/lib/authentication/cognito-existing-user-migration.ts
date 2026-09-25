import "server-only";

import { getPostgresPool } from "@/lib/database/postgres-pool";
import { withPostgresAuthorization } from "@/lib/database/postgres-authorization-core";
import { assertIdentityMutationAllowed } from "@/lib/email/notification-mode";

import { getCognitoMigrationDirectory } from "./cognito-admin";
import { migrateExistingUserToCognito } from "./cognito-existing-user-migration-core";
import { parseCognitoTargetConfiguration } from "./cognito-runtime-configuration-core";

export async function provisionExistingCognitoUser(input: {
  actorUserId: string;
  departmentId: string;
  targetUserId: string;
  siteUrl: string;
}) {
  assertIdentityMutationAllowed();
  const pool = getPostgresPool();
  // Stable UUIDs make retries converge on the same lifecycle operation and
  // Cognito username after any ambiguous provider/database response.
  const operationId = input.targetUserId;
  const prior = await pool.query(
    "select provider_username from public.authentication_lifecycle_operations where id=$1 and operation_kind='migrate_identity' and tracepoint_user_id=$1 and department_id=$2 and state='compensation_required'",
    [input.targetUserId, input.departmentId],
  );
  const providerUsername = prior.rowCount === 1 ? String(prior.rows[0].provider_username) : input.targetUserId;
  const config = parseCognitoTargetConfiguration(process.env);
  const issuer = `https://cognito-idp.${config.verification.region}.amazonaws.com/${config.verification.userPoolId}`;
  const directory = getCognitoMigrationDirectory();

  return migrateExistingUserToCognito(
    { ...input, operationId, providerUsername },
    {
      directory,
      issuer,
      async sendActivation(value) { await directory.resendInvitation(value.email, value.providerSubject); },
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
          const client = await pool.connect();
          try {
            await client.query("begin");
            await client.query("select tracepoint_auth.confirm_cognito_provider_username($1,$2,$3,$4)",
              [value.operationId, value.requestedUsername, value.actualUsername, value.subject]);
            await client.query("select tracepoint_auth.commit_existing_cognito_migration($1,$2,$3)", [value.operationId, value.subject, value.issuer]);
            await client.query("commit");
          } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
          finally { client.release(); }
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
  assertIdentityMutationAllowed();
  const pool = getPostgresPool();
  const config = parseCognitoTargetConfiguration(process.env);
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
      row.provider_username !== row.subject || row.link_state !== "pending" ||
      !["provider_succeeded", "compensation_required", "committed"].includes(row.state)) {
    throw new Error("Existing Cognito migration cannot be resumed safely.");
  }
  if (row.state === "committed") return { userId: input.targetUserId, operationId: input.targetUserId, alreadyDelivered: true };
  if (row.state === "compensation_required") {
    await pool.query("select tracepoint_auth.commit_existing_cognito_migration($1,$2,$3)", [input.targetUserId, row.subject, issuer]);
  }
  await getCognitoMigrationDirectory().resendInvitation(row.email, row.subject);
  await pool.query("select tracepoint_auth.finish_existing_cognito_migration($1,true,null)", [input.targetUserId]);
  return { userId: input.targetUserId, operationId: input.targetUserId, alreadyDelivered: false };
}
