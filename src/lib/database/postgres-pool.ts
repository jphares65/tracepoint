import "server-only";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { parsePostgresPoolConfiguration } from "./postgres-pool-core";

let pool: Pool | undefined;
export function getPostgresPool(environment = process.env): Pool {
  if (pool) return pool;
  const configuration = parsePostgresPoolConfiguration(environment);
  const ca = readFileSync(configuration.caPath, "utf8");
  if (!ca.includes("BEGIN CERTIFICATE")) throw new Error("Invalid RDS CA bundle.");
  pool = new Pool({ host: configuration.secret.host, port: configuration.secret.port, user: configuration.secret.username, password: configuration.secret.password, database: configuration.secret.dbname, ssl: { ca, rejectUnauthorized: true }, max: configuration.maximumConnections, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000, statement_timeout: 30_000, application_name: "tracepoint-web" });
  pool.on("error", () => undefined);
  return pool;
}
