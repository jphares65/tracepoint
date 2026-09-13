import "server-only";

import { getPostgresPool } from "@/lib/database/postgres-pool";
import { withPostgresSubjectAuthorization } from "@/lib/database/postgres-authorization-core";

import { getCognitoMigrationDirectory } from "./cognito-admin";
import {
  migrateExceptionalUserToCognito,
  type ExceptionalIdentityDisposition,
  type ExceptionalIdentityMigrationInput,
} from "./cognito-exceptional-identity-migration-core";
import { parseCognitoTargetConfiguration } from "./cognito-runtime-configuration-core";

export async function provisionExceptionalCognitoUser(input: {
  actorUserId: string;
  targetUserId: string;
  disposition: ExceptionalIdentityDisposition;
}) {
  const pool = getPostgresPool();
  const providerUsername = input.targetUserId;
  const config = parseCognitoTargetConfiguration(process.env);
  const issuer = `https://cognito-idp.${config.verification.region}.amazonaws.com/${config.verification.userPoolId}`;
  const migrationInput: ExceptionalIdentityMigrationInput = { ...input, providerUsername };
  return migrateExceptionalUserToCognito(migrationInput, {
    directory: getCognitoMigrationDirectory(),
    issuer,
    store: {
      async prepare(value) {
        const result = await withPostgresSubjectAuthorization(pool, { subjectId: input.actorUserId }, client => client.query(
          "select * from tracepoint_auth.prepare_exceptional_cognito_migration($1,$2)",
          [value.targetUserId, value.disposition],
        )) as { rowCount: number | null; rows: Array<{ email: string; full_name: string }> };
        if (result.rowCount !== 1) throw new Error("Exceptional identity is not eligible for the requested disposition.");
        return { email: String(result.rows[0].email), fullName: String(result.rows[0].full_name) };
      },
      async commit(value) {
        await withPostgresSubjectAuthorization(pool, { subjectId: input.actorUserId }, client => client.query(
          "select tracepoint_auth.commit_exceptional_cognito_migration($1,$2,$3,$4,$5)",
          [value.targetUserId, value.disposition, value.issuer, value.subject, value.providerUsername],
        ));
      },
    },
  });
}

export async function readExceptionalCognitoMigration(input: {
  actorUserId: string;
  targetUserId: string;
  disposition: ExceptionalIdentityDisposition;
}) {
  const pool = getPostgresPool();
  const result = await withPostgresSubjectAuthorization(pool, { subjectId: input.actorUserId }, client => client.query(
    "select * from tracepoint_auth.read_exceptional_cognito_migration($1,$2)",
    [input.targetUserId, input.disposition],
  )) as { rowCount: number | null; rows: Array<{ issuer: string; subject: string; state: string; provider_username: string }> };
  if (result.rowCount !== 1) throw new Error("Exceptional Cognito mapping reconciliation failed.");
  return {
    issuer: String(result.rows[0].issuer),
    subject: String(result.rows[0].subject),
    state: String(result.rows[0].state),
    providerUsername: String(result.rows[0].provider_username),
  };
}
