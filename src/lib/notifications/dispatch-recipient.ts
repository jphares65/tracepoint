import type { Pool } from "pg";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase and PostgresDataClient share this query shape
type MembershipClient = { from(table: string): any };

// Members deactivated after a digest was queued must not receive it (TRN-16).
// AWS-native asks the server-only membership function (database/aws/047); the
// bridge service-role client reads memberships directly.
export function notificationRecipientCheck(pool: Pick<Pool, "query"> | null, admin: MembershipClient) {
  return async (departmentId: string, userId: string) => {
    if (pool) {
      const result = await pool.query(
        "select tracepoint_auth.notification_recipient_active($1::uuid,$2::uuid) as active",
        [departmentId, userId],
      );
      return result.rows[0]?.active === true;
    }
    const { data, error } = await admin.from("department_memberships")
      .select("user_id").eq("department_id", departmentId).eq("user_id", userId)
      .eq("is_active", true).limit(1);
    if (error) throw new Error(error.message);
    return Array.isArray(data) && data.length > 0;
  };
}
