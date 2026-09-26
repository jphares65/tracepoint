import { readFileSync } from "node:fs";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import pg from "pg";
import { ManagedSesProvider } from "../src/lib/email/ses-managed-provider.ts";
import { PostgresSesFeedbackStore } from "../src/lib/email/ses-feedback-postgres.ts";

const account = "559054714699";
const host = "tracepoint-staging-full-aws.ck1qg8mekjg4.us-east-1.rds.amazonaws.com";
const departmentId = "a2280768-d6c4-4433-90b6-2399c514ed63";
const recipient = "success@simulator.amazonses.com";

async function main() {
  if (process.env.TRACEPOINT_STAGING_SES_PROOF !== "20260926" ||
      process.env.TRACEPOINT_AWS_ACCOUNT_ID !== account ||
      process.env.AWS_REGION !== "us-east-1") throw new Error("STAGING_IDENTITY_FAIL");
  const secret = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON ?? "null");
  if (secret?.host !== host || secret?.port !== 5432 || secret?.dbname !== "tracepoint" ||
      secret?.username !== "tracepoint_runtime") throw new Error("STAGING_DATABASE_PIN_FAIL");
  const ca = readFileSync("/app/rds-ca.pem", "utf8");
  if (!ca.includes("BEGIN CERTIFICATE")) throw new Error("STAGING_CA_FAIL");
  const pool = new pg.Pool({ host, port: 5432, user: secret.username, password: secret.password,
    database: "tracepoint", ssl: { ca, rejectUnauthorized: true }, max: 1,
    connectionTimeoutMillis: 10000, statement_timeout: 30000 });
  try {
    const identity = (await pool.query("select current_database() as database, current_user as role")).rows[0];
    if (identity.database !== "tracepoint" || identity.role !== "tracepoint_runtime") {
      throw new Error("STAGING_DB_ROLE_FAIL");
    }
    const store = new PostgresSesFeedbackStore(pool);
    if (await store.isSuppressed(recipient)) throw new Error("SIMULATOR_RECIPIENT_SUPPRESSED");
    const provider = new ManagedSesProvider({
      fromEmail: "notifications@staging.tracepointhq.com",
      configurationSet: "tracepoint-staging",
      transport: new SESv2Client({ region: "us-east-1", maxAttempts: 1 }),
    }, store, departmentId);
    const accepted = await provider.send({
      to: [{ email: recipient }],
      subject: "TracePoint isolated application SES provider proof",
      textContent: "Synthetic staging test only. No customer data.",
      htmlContent: "<p>Synthetic staging test only. No customer data.</p>",
    });
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
    code: error?.code ?? error?.name ?? "ERROR" }));
  process.exitCode = 1;
});
