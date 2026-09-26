import { readFileSync } from "node:fs";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import pg from "pg";
import { ManagedSesProvider } from "../src/lib/email/ses-managed-provider.ts";
import { PostgresSesFeedbackStore } from "../src/lib/email/ses-feedback-postgres.ts";

const account = "559054714699";
const host = "tracepoint-staging-full-aws.ck1qg8mekjg4.us-east-1.rds.amazonaws.com";
const departmentId = "a2280768-d6c4-4433-90b6-2399c514ed63";
const recipient = "success@simulator.amazonses.com";
let stage = "environment";

async function main() {
  if (process.env.TRACEPOINT_STAGING_SES_PROOF !== "20260926" ||
      process.env.TRACEPOINT_AWS_ACCOUNT_ID !== account ||
      process.env.AWS_REGION !== "us-east-1") throw new Error("STAGING_IDENTITY_FAIL");
  stage = "database_pin";
  const secret = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON ?? "null");
  if (secret?.host !== host || secret?.port !== 5432 || secret?.dbname !== "tracepoint" ||
      secret?.username !== "tracepoint_runtime") throw new Error("STAGING_DATABASE_PIN_FAIL");
  stage = "ca";
  const ca = readFileSync("/app/rds-ca.pem", "utf8");
  if (!ca.includes("BEGIN CERTIFICATE")) throw new Error("STAGING_CA_FAIL");
  const pool = new pg.Pool({ host, port: 5432, user: secret.username, password: secret.password,
    database: "tracepoint", ssl: { ca, rejectUnauthorized: true }, max: 1,
    connectionTimeoutMillis: 10000, statement_timeout: 30000 });
  try {
    stage = "database_identity";
    const identity = (await pool.query("select current_database() as database, current_user as role")).rows[0];
    if (identity.database !== "tracepoint" || identity.role !== "tracepoint_runtime") {
      throw new Error("STAGING_DB_ROLE_FAIL");
    }
    stage = "prior_acceptance_audit";
    const prior = await pool.query(
      "select count(*)::int as n from public.email_provider_acceptances where department_id=$1 and created_at >= $2::timestamptz",
      [departmentId, "2026-09-26T17:50:00Z"],
    );
    if (process.env.TRACEPOINT_STAGING_SES_PROOF_MODE !== "send") {
      console.log(JSON.stringify({ event: "STAGING_APP_SES_PROOF_AUDIT", recentAcceptanceCount: prior.rows[0].n,
        tenantPinned: true, tlsVerified: true }));
      return;
    }
    if (prior.rows[0].n !== 0) throw new Error("PRIOR_ACCEPTANCE_RECONCILIATION_REQUIRED");
    stage = "suppression_read";
    const store = new PostgresSesFeedbackStore(pool);
    if (await store.isSuppressed(recipient)) throw new Error("SIMULATOR_RECIPIENT_SUPPRESSED");
    const tracedStore = {
      isSuppressed: email => { stage = "provider_suppression_read"; return store.isSuppressed(email); },
      recordAcceptance: (messageId, tenantId, recipients) => {
        stage = "record_acceptance";
        return store.recordAcceptance(messageId, tenantId, recipients);
      },
    };
    const ses = new SESv2Client({ region: "us-east-1", maxAttempts: 1 });
    const provider = new ManagedSesProvider({
      fromEmail: "notifications@staging.tracepointhq.com",
      configurationSet: "tracepoint-staging",
      transport: { send: async command => {
        stage = "ses_api";
        const result = await ses.send(command);
        stage = "ses_accepted";
        return result;
      } },
    }, tracedStore, departmentId);
    stage = "provider_send";
    const accepted = await provider.send({
      to: [{ email: recipient }],
      subject: "TracePoint isolated application SES provider proof",
      textContent: "Synthetic staging test only. No customer data.",
      htmlContent: "<p>Synthetic staging test only. No customer data.</p>",
    });
    stage = "acceptance_verify";
    const result = await pool.query(
      "select count(*)::int as n from public.email_provider_acceptances where message_id=$1 and department_id=$2",
      [accepted.messageId, departmentId],
    );
    if (result.rows[0]?.n !== 1) throw new Error("APP_ACCEPTANCE_MISSING");
    console.log(JSON.stringify({ event: "STAGING_APP_SES_PROVIDER_PASS", messageId: accepted.messageId,
      acceptanceRecorded: true, tenantPinned: true, tlsVerified: true }));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ event: "STAGING_APP_SES_PROVIDER_FAIL",
    stage, code: error?.code ?? error?.name ?? "ERROR",
    guard: /^STAGING_|^SIMULATOR_|^APP_ACCEPTANCE_|^PRIOR_ACCEPTANCE_/.test(error?.message ?? "") ? error.message : undefined }));
  process.exitCode = 1;
});
