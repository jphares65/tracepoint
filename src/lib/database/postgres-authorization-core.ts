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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertContext(context: PostgresAuthorizationContext) {
  if (!uuidPattern.test(context.subjectId) || !uuidPattern.test(context.departmentId)) {
    throw new Error("Valid authorization subject and department are required.");
  }
}

export async function withPostgresAuthorization<T>(
  pool: PostgresAuthorizationPool,
  context: PostgresAuthorizationContext,
  operation: (client: PostgresAuthorizationClient) => Promise<T>,
): Promise<T> {
  assertContext(context);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('tracepoint.subject_id', $1, true)", [context.subjectId]);
    await client.query("select set_config('tracepoint.department_id', $1, true)", [context.departmentId]);
    if (context.supportMode === true) {
      await client.query("select set_config('tracepoint.support_department_id', $1, true)", [context.departmentId]);
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
  if (!uuidPattern.test(context.subjectId)) {
    throw new Error("Valid authorization subject is required.");
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('tracepoint.subject_id', $1, true)", [context.subjectId]);
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
