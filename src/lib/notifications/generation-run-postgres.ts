import type { Pool } from "pg";
import type { GenerationDependencies, GenerationRequest } from "./generation-run-core.ts";

export const generationTargetsSql = `select department_id, user_id
  from tracepoint_auth.list_notification_generation_targets($1::uuid,$2::uuid,$3::uuid,$4::integer)`;
const lockKey = "hashtext('tracepoint.notification_generation')";

export function postgresGenerationTargets(pool: Pick<Pool, "query">) {
  return async (request: GenerationRequest) => {
    const result = await pool.query(generationTargetsSql, [
      request.departmentId, request.after?.departmentId ?? null, request.after?.userId ?? null, request.limit,
    ]);
    return result.rows.map((row) => ({ departmentId: String(row.department_id), userId: String(row.user_id) }));
  };
}

// A session advisory lock on one dedicated connection: concurrent runs do not
// overlap, and the lock is released with the connection if unlocking fails.
export function postgresGenerationLock(pool: Pick<Pool, "connect">): GenerationDependencies["withRunLock"] {
  return async (run) => {
    const client = await pool.connect();
    let broken: Error | undefined;
    try {
      const locked = await client.query(`select pg_try_advisory_lock(${lockKey}) as acquired`);
      if (locked.rows[0]?.acquired !== true) return { acquired: false };
      try {
        return { acquired: true, value: await run() };
      } finally {
        await client.query(`select pg_advisory_unlock(${lockKey})`).catch((error: Error) => { broken = error; });
      }
    } catch (error) {
      broken = error instanceof Error ? error : new Error("Notification generation lock failed.");
      throw error;
    } finally {
      client.release(broken);
    }
  };
}
