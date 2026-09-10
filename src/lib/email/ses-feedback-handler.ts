import { readFileSync } from "node:fs";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { Pool } from "pg";
import { createSesFeedbackBatchHandler } from "./ses-feedback-batch";
import { PostgresSesFeedbackStore } from "./ses-feedback-postgres";

type QueueEvent = { Records: Array<{ messageId: string; body: string }> };
type DatabaseSecret = { host: string; port: number; username: string; password: string; dbname: string };

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing SES feedback worker setting: ${name}.`);
  return value;
}

export function parseSesFeedbackDatabaseSecret(value: string | undefined): DatabaseSecret {
  const parsed = JSON.parse(value ?? "null") as Partial<DatabaseSecret> | null;
  const validHost = typeof parsed?.host === "string" &&
    /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.rds(?:\.[a-z0-9-]+)?\.amazonaws\.com$/.test(parsed.host);
  if (!parsed || !validHost || parsed.port !== 5432 ||
      parsed.username !== "tracepoint_runtime" || typeof parsed.password !== "string" || parsed.password.length < 20 ||
      parsed.dbname !== "tracepoint") throw new Error("Invalid SES feedback database secret.");
  return parsed as DatabaseSecret;
}

let initialized: Promise<ReturnType<typeof createSesFeedbackBatchHandler>> | undefined;

async function initialize() {
  const region = required("AWS_REGION");
  const secretArn = required("TRACEPOINT_DATABASE_SECRET_ARN");
  const ca = readFileSync(required("TRACEPOINT_RDS_CA_PATH"), "utf8");
  if (!ca.includes("BEGIN CERTIFICATE")) throw new Error("Invalid SES feedback RDS CA bundle.");
  const result = await new SecretsManagerClient({ region, maxAttempts: 2 }).send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  const secret = parseSesFeedbackDatabaseSecret(result.SecretString);
  const pool = new Pool({
    host: secret.host, port: secret.port, user: secret.username, password: secret.password, database: secret.dbname,
    ssl: { ca, rejectUnauthorized: true }, max: 2, connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000, statement_timeout: 30_000, application_name: "tracepoint-ses-feedback",
  });
  pool.on("error", () => undefined);
  return createSesFeedbackBatchHandler({
    account: required("TRACEPOINT_AWS_ACCOUNT"),
    topicArn: required("TRACEPOINT_SES_FEEDBACK_TOPIC_ARN"),
    store: new PostgresSesFeedbackStore(pool),
  });
}

export async function handler(event: QueueEvent) {
  initialized ??= initialize().catch((error) => {
    initialized = undefined;
    throw error;
  });
  return (await initialized)(event);
}
