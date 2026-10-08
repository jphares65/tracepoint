import { normalizePostgresUuid } from "./postgres-uuid.ts";

export type PostgresAuthorizationClient = {
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
  release(): void;
};

export type PostgresAuthorizationPool = {
  connect(): Promise<PostgresAuthorizationClient>;
};

export type PostgresAuthorizationContext = {
  subjectId: string;
  departmentId: string;
  supportMode?: boolean;
};

export type PostgresSubjectContext = {
  subjectId: string;
};

function normalizeContext(context: PostgresAuthorizationContext): PostgresAuthorizationContext {
  const subjectId = normalizePostgresUuid(context.subjectId);
  const departmentId = normalizePostgresUuid(context.departmentId);
  if (!subjectId || !departmentId) {
    throw new Error("Valid authorization subject and department are required.");
  }
  return { ...context, subjectId, departmentId };
}

export async function withPostgresAuthorization<T>(
  pool: PostgresAuthorizationPool,
  context: PostgresAuthorizationContext,
  operation: (client: PostgresAuthorizationClient) => Promise<T>,
): Promise<T> {
  const normalizedContext = normalizeContext(context);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('tracepoint.subject_id', $1, true)", [normalizedContext.subjectId]);
    await client.query("select set_config('tracepoint.department_id', $1, true)", [normalizedContext.departmentId]);
    if (normalizedContext.supportMode === true) {
      await client.query("select set_config('tracepoint.support_department_id', $1, true)", [normalizedContext.departmentId]);
    }
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function withPostgresSubjectAuthorization<T>(
  pool: PostgresAuthorizationPool,
  context: PostgresSubjectContext,
  operation: (client: PostgresAuthorizationClient) => Promise<T>,
): Promise<T> {
  const subjectId = normalizePostgresUuid(context.subjectId);
  if (!subjectId) {
    throw new Error("Valid authorization subject is required.");
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('tracepoint.subject_id', $1, true)", [subjectId]);
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
