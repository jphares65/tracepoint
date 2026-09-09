export type PostgresSecret = { host: string; port: number; username: string; password: string; dbname: string };
export type PostgresPoolConfiguration = { secret: PostgresSecret; region: string; caPath: string; maximumConnections: number };

const regionPattern = /^us-(?:gov-)?(?:east|west)-\d$/;
const hostPattern = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.rds(?:\.[a-z0-9-]+)?\.amazonaws\.com$/;

export function parsePostgresPoolConfiguration(environment: Record<string, string | undefined>): PostgresPoolConfiguration {
  if (environment.TRACEPOINT_DATA_PROVIDER !== "postgres") throw new Error("PostgreSQL pool requires TRACEPOINT_DATA_PROVIDER=postgres.");
  if (!regionPattern.test(environment.AWS_REGION ?? "")) throw new Error("A supported AWS or GovCloud region is required.");
  if (!environment.TRACEPOINT_DATABASE_CA_PATH?.trim()) throw new Error("TRACEPOINT_DATABASE_CA_PATH is required for verified TLS.");
  let value: unknown;
  try { value = JSON.parse(environment.TRACEPOINT_DATABASE_SECRET_JSON ?? ""); }
  catch { throw new Error("TRACEPOINT_DATABASE_SECRET_JSON must be valid JSON."); }
  if (!value || typeof value !== "object") throw new Error("Invalid PostgreSQL secret.");
  const secret = value as Partial<PostgresSecret>;
  if (typeof secret.host !== "string" || !hostPattern.test(secret.host) || secret.port !== 5432 || typeof secret.username !== "string" || !/^[a-z][a-z0-9_]{2,62}$/.test(secret.username) || typeof secret.password !== "string" || secret.password.length < 20 || secret.dbname !== "tracepoint") throw new Error("Invalid PostgreSQL secret fields.");
  const maximumConnections = Number(environment.TRACEPOINT_DATABASE_POOL_MAX ?? "10");
  if (!Number.isInteger(maximumConnections) || maximumConnections < 1 || maximumConnections > 20) throw new Error("TRACEPOINT_DATABASE_POOL_MAX must be between 1 and 20.");
  return { secret: secret as PostgresSecret, region: environment.AWS_REGION!, caPath: environment.TRACEPOINT_DATABASE_CA_PATH, maximumConnections };
}
