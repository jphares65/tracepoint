import "server-only";

import { getPostgresPool } from "@/lib/database/postgres-pool";

import { getCognitoMigrationDirectory } from "./cognito-admin";
import {
  migrateExceptionalUserToCognito,
  type ExceptionalIdentityDisposition,
  type ExceptionalIdentityMigrationInput,
} from "./cognito-exceptional-identity-migration-core";
import { parseCognitoTargetConfiguration } from "./cognito-runtime-configuration-core";

export async function provisionExceptionalCognitoUser(input: {
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
        const eligibility = value.disposition === "inactive-disabled"
          ? `exists(select 1 from public.department_memberships membership where membership.user_id=profile.id)
             and not exists(select 1 from public.department_memberships membership where membership.user_id=profile.id and membership.is_active)
             and not exists(select 1 from public.platform_admins administrator where administrator.user_id=profile.id and administrator.is_active)`
          : `exists(select 1 from public.platform_admins administrator where administrator.user_id=profile.id and administrator.is_active)
             and not exists(select 1 from public.department_memberships membership where membership.user_id=profile.id)`;
        const result = await pool.query(
          `select lower(btrim(profile.email)) as email,btrim(profile.full_name) as full_name
           from public.profiles profile where profile.id=$1 and nullif(btrim(profile.email),'') is not null
             and nullif(btrim(profile.full_name),'') is not null and ${eligibility}
             and (select count(*) from public.profiles candidate where lower(btrim(candidate.email))=lower(btrim(profile.email)))=1`,
          [value.targetUserId],
        );
        if (result.rowCount !== 1) throw new Error("Exceptional identity is not eligible for the requested disposition.");
        return { email: String(result.rows[0].email), fullName: String(result.rows[0].full_name) };
      },
      async commit(value) {
        const client = await pool.connect();
        try {
          await client.query("begin");
          const eligibility = value.disposition === "inactive-disabled"
            ? `exists(select 1 from public.department_memberships membership where membership.user_id=profile.id)
               and not exists(select 1 from public.department_memberships membership where membership.user_id=profile.id and membership.is_active)
               and not exists(select 1 from public.platform_admins administrator where administrator.user_id=profile.id and administrator.is_active)`
            : `exists(select 1 from public.platform_admins administrator where administrator.user_id=profile.id and administrator.is_active)
               and not exists(select 1 from public.department_memberships membership where membership.user_id=profile.id)`;
          const locked = await client.query(
            `select profile.id from public.profiles profile where profile.id=$1 and ${eligibility} for update`,
            [value.targetUserId],
          );
          if (locked.rowCount !== 1) throw new Error("Exceptional identity eligibility changed.");
          const state = value.disposition === "inactive-disabled" ? "revoked" : "pending";
          const existing = await client.query(
            `select issuer,subject,state,provider_username from public.authentication_identity_links
             where provider='cognito' and tracepoint_user_id=$1 for update`,
            [value.targetUserId],
          );
          if (existing.rowCount === 1) {
            const row = existing.rows[0];
            if (row.issuer !== value.issuer || row.subject !== value.subject || row.state !== state || row.provider_username !== value.providerUsername) {
              throw new Error("Exceptional identity link does not reconcile.");
            }
          } else if (existing.rowCount === 0) {
            await client.query(
              `insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state,provider_username)
               values('cognito',$1,$2,$3,$4,$5)`,
              [value.issuer, value.subject, value.targetUserId, state, value.providerUsername],
            );
            await client.query(
              `insert into public.authentication_identity_events(tracepoint_user_id,provider,issuer,subject,provider_username,event_type)
               values($1,'cognito',$2,$3,$4,$5)`,
              [value.targetUserId, value.issuer, value.subject, value.providerUsername, state === "revoked" ? "revoked" : "linked"],
            );
          } else {
            throw new Error("Exceptional identity link is ambiguous.");
          }
          await client.query("commit");
        } catch (error) {
          await client.query("rollback").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      },
    },
  });
}
