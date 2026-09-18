import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { executeSyntheticCognitoMigration, planSyntheticCognitoMigration } from "./synthetic-cognito-migration-core.mjs";

const option = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const manifestPath = option("--manifest");
if (!manifestPath) throw new Error("--manifest is required.");
const plan = planSyntheticCognitoMigration(JSON.parse(await readFile(manifestPath, "utf8")));
const output = option("--evidence");
const execute = process.argv.includes("--execute");
const authorizationReference = option("--authorization-reference");

if (!execute) {
  if (output) await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ dryRun: true, departmentId: plan.departmentId, users: plan.users.length, manifestHash: plan.manifestHash, evidenceWritten: Boolean(output) }));
  process.exit(0);
}
if (!output || !authorizationReference || process.env.TRACEPOINT_SYNTHETIC_MIGRATION_AUTHORIZATION !== authorizationReference) {
  throw new Error("Execution requires a matching authorization reference and a new --evidence file.");
}
if (process.env.AWS_REGION !== "us-east-1" || process.env.TRACEPOINT_AWS_ACCOUNT_ID !== "559054714699") {
  throw new Error("The synthetic identity writer is bounded to the staging account and us-east-1.");
}
const userPoolId = process.env.TRACEPOINT_COGNITO_USER_POOL_ID;
if (!/^us-east-1_[A-Za-z0-9]+$/.test(userPoolId ?? "") || plan.issuer !== `https://cognito-idp.us-east-1.amazonaws.com/${userPoolId}`) {
  throw new Error("The manifest issuer must exactly match the bounded staging user pool.");
}
let database;
try {
  database = JSON.parse(process.env.TRACEPOINT_MIGRATOR_SECRET_JSON ?? "");
} catch {
  throw new Error("Invalid migrator configuration.");
}
if (database.dbname !== "tracepoint" || database.port !== 5432 || typeof database.host !== "string" ||
    !database.host.endsWith(".us-east-1.rds.amazonaws.com") || typeof database.username !== "string" || typeof database.password !== "string") {
  throw new Error("Bounded staging PostgreSQL target required.");
}

const ca = await readFile(process.env.TRACEPOINT_DATABASE_CA_PATH ?? "");
const { Client } = await import("pg");
const { AdminCreateUserCommand, AdminDisableUserCommand, AdminGetUserCommand, CognitoIdentityProviderClient } = await import("@aws-sdk/client-cognito-identity-provider");
const sql = new Client({ ...database, ssl: { ca, rejectUnauthorized: true } });
const cognito = new CognitoIdentityProviderClient({ region: "us-east-1" });
const attribute = (attributes, name) => attributes?.find((item) => item.Name === name)?.Value;
await sql.connect();
try {
  // Refuse before creating users unless all source UUIDs, memberships, and roles reconcile.
  for (const user of plan.users) {
    const source = await sql.query(
      `select p.id,coalesce(array_agg(r.role_code order by r.role_code)
         filter(where r.role_code is not null),'{}') roles
       from public.profiles p
       join public.department_memberships m on m.user_id=p.id and m.department_id=$2
       left join public.department_membership_roles r on r.user_id=p.id and r.department_id=m.department_id
       where p.id=$1 group by p.id`,
      [user.tracepointUserId, plan.departmentId],
    );
    if (source.rowCount !== 1 || JSON.stringify(source.rows[0].roles) !== JSON.stringify([...user.roles].sort())) {
      throw new Error(`Source membership or role reconciliation refused for ${user.tracepointUserId}.`);
    }
  }

  const adapter = {
    async getUser(username) {
      try {
        const result = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
        return { tracepointUserId: username.slice(3, 39), subject: attribute(result.UserAttributes, "sub") };
      } catch (error) {
        if (error?.name === "UserNotFoundException") return null;
        throw error;
      }
    },
    async createUser(user) {
      const temporaryPassword = `${randomBytes(30).toString("base64url")}aA1!`;
      const result = await cognito.send(new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: user.username,
        TemporaryPassword: temporaryPassword,
        MessageAction: user.messageAction,
        UserAttributes: [{ Name: "email", Value: user.email }, { Name: "email_verified", Value: "true" }],
      }));
      const subject = attribute(result.User?.Attributes, "sub");
      if (!subject) throw new Error("Cognito did not return an immutable subject.");
      return subject;
    },
    async preserveAuthorization(user) {
      await sql.query("begin");
      try {
        const previousMembership = await sql.query(
          "select is_active from public.department_memberships where department_id=$1 and user_id=$2 for update",
          [user.departmentId, user.tracepointUserId],
        );
        const previousLink = await sql.query(
          `select state from public.authentication_identity_links
           where provider='cognito' and issuer=$1 and subject=$2 and tracepoint_user_id=$3 for update`,
          [user.issuer, user.subject, user.tracepointUserId],
        );
        const state = user.activationState === "active" ? "active" : user.activationState === "inactive" ? "revoked" : "pending";
        await sql.query(
          `update public.department_memberships set is_active=$3,
             deactivated_at=case when $3 then null else coalesce(deactivated_at,now()) end,updated_at=now()
           where department_id=$1 and user_id=$2`,
          [user.departmentId, user.tracepointUserId, user.membershipActive],
        );
        const conflicts = await sql.query(
          `select subject,tracepoint_user_id from public.authentication_identity_links
           where provider='cognito' and issuer=$1 and (subject=$2 or tracepoint_user_id=$3)`,
          [user.issuer, user.subject, user.tracepointUserId],
        );
        if (conflicts.rows.some((row) => row.subject !== user.subject || row.tracepoint_user_id !== user.tracepointUserId)) {
          throw new Error("Authentication identity link conflict refused.");
        }
        await sql.query(
          `insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state)
           values('cognito',$1,$2,$3,$4)
           on conflict(provider,issuer,subject) do update set state=excluded.state,updated_at=now()
           where authentication_identity_links.tracepoint_user_id=excluded.tracepoint_user_id`,
          [user.issuer, user.subject, user.tracepointUserId, state],
        );
        await sql.query("commit");
        return {
          restoreMembershipActive: previousMembership.rows[0].is_active,
          restoreIdentityState: previousLink.rows[0]?.state ?? null,
        };
      } catch (error) {
        await sql.query("rollback");
        throw error;
      }
    },
    async disableUser(username) {
      await cognito.send(new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: username }));
    },
    async reconcile(currentPlan, evidence) {
      for (const migrated of evidence) {
        const result = await sql.query(
          `select state from public.authentication_identity_links
           where provider='cognito' and issuer=$1 and subject=$2 and tracepoint_user_id=$3`,
          [currentPlan.issuer, migrated.subject, migrated.tracepointUserId],
        );
        if (result.rowCount !== 1) throw new Error("Post-migration identity reconciliation failed.");
      }
    },
  };
  const evidence = await executeSyntheticCognitoMigration(plan, adapter, { authorized: true });
  await writeFile(output, `${JSON.stringify({ ...evidence, authorizationReference }, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ dryRun: false, departmentId: plan.departmentId, users: plan.users.length, manifestHash: plan.manifestHash, reconciled: true, evidenceWritten: true }));
} finally {
  cognito.destroy();
  await sql.end();
}
