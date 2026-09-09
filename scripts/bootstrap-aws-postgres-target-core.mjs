const requiredText = (value, name) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
};

const parseSecret = (raw, name) => {
  let value;
  try { value = JSON.parse(requiredText(raw, name)); }
  catch { throw new Error(`${name} must be valid JSON.`); }
  const port = Number(value.port);
  if (!Number.isInteger(port) || port !== 5432) throw new Error(`${name} must use PostgreSQL port 5432.`);
  return {
    host: requiredText(value.host, `${name}.host`).toLowerCase(),
    port,
    username: requiredText(value.username, `${name}.username`),
    password: requiredText(value.password, `${name}.password`),
    dbname: requiredText(value.dbname, `${name}.dbname`),
  };
};

export function parseBootstrapConfiguration(environment) {
  const region = requiredText(environment.AWS_REGION, "AWS_REGION");
  const migrator = parseSecret(environment.TRACEPOINT_MIGRATOR_SECRET_JSON, "TRACEPOINT_MIGRATOR_SECRET_JSON");
  const runtime = parseSecret(environment.TRACEPOINT_RUNTIME_DATABASE_SECRET_JSON, "TRACEPOINT_RUNTIME_DATABASE_SECRET_JSON");
  const caPath = requiredText(environment.TRACEPOINT_DATABASE_CA_PATH, "TRACEPOINT_DATABASE_CA_PATH");
  const expectedSuffix = `.${region}.rds.amazonaws.com`;
  if (!migrator.host.endsWith(expectedSuffix) || runtime.host !== migrator.host || runtime.dbname !== migrator.dbname || runtime.port !== migrator.port) {
    throw new Error("Migrator and runtime secrets must identify the same regional RDS database.");
  }
  if (runtime.username !== "tracepoint_runtime" || runtime.password.length < 32) throw new Error("Runtime secret must contain the bounded tracepoint_runtime login.");
  if (migrator.username === runtime.username || migrator.password === runtime.password) throw new Error("Migrator and runtime credentials must be distinct.");
  return { region, migrator, runtime, caPath };
}

export function normalizeTransactionalSql(raw, filename) {
  let sql = raw.replace(/^\uFEFF/, "");
  sql = sql.replace(/^(\s*(?:--[^\r\n]*(?:\r?\n|$)\s*)*)begin\s*;/i, "$1");
  sql = sql.replace(/commit\s*;\s*$/i, "");
  if (/\b(?:begin|commit|rollback)\s*;/i.test(sql)) throw new Error(`${filename} contains unsupported nested transaction control.`);
  return sql;
}
