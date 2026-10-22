import type { TracePointPermission } from "@/lib/tracepoint/permissions";

// Owner decision: withdrawing a submitted ammunition reconciliation is a
// management action that needs a reason and an audit record. Until a dedicated
// permission exists in the catalog (a database change), it is limited to
// agency administrators.
export const RECONCILIATION_WITHDRAW_PERMISSIONS: readonly TracePointPermission[] = ["administer_department"];

// The withdrawal and its audit row in one statement, so on AWS-native they
// commit or fail together. Runs as the request's authenticated role, under the
// 052 update policy and audit_events_insert_managers (20260721). Two separate
// writes could not be undone safely: the 052 policy refuses restoring another
// member's submission, so a failed audit insert left an unaudited withdrawal.
// $1 reconciliation, $2 agency, $3 updated_at, $4 actor, $5 reason.
export const RECONCILIATION_WITHDRAW_SQL = `with prior as (
  select id, submitted_at, submitted_by from public.ammunition_reconciliations
  where id = $1::uuid and department_id = $2::uuid and status = 'Submitted'
  for update
), withdrawn as (
  update public.ammunition_reconciliations r
  set status = 'Draft', submitted_at = null, submitted_by = null, updated_at = $3::timestamptz
  from prior where r.id = prior.id and r.status = 'Submitted'
  returning r.id, prior.submitted_at, prior.submitted_by
), audit as (
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, previous_value, new_value)
  select $2::uuid, $4::uuid, 'ammunition_reconciliation_withdrawn', 'ammunition_reconciliation', id, $5::text,
    jsonb_build_object('status', 'Submitted', 'submitted_at', submitted_at, 'submitted_by', submitted_by),
    jsonb_build_object('status', 'Draft')
  from withdrawn
  returning entity_id
)
select (select count(*) from withdrawn)::int as withdrawn, (select count(*) from audit)::int as audited`;

type Executor = { execute(text: string, values: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }> };

/** The AWS-native data client runs SQL in one authorized transaction; the bridge client cannot. */
export function atomicWithdrawalClient(admin: unknown): Executor | null {
  return admin && typeof (admin as Executor).execute === "function" ? admin as Executor : null;
}

/** Withdraws and audits in one statement. "withdrawn" also means audited. */
export async function withdrawReconciliationAtomically(client: Executor, input: {
  reconciliationId: string; departmentId: string; actorUserId: string; reason: string; now: string;
}): Promise<"withdrawn" | "not_submitted"> {
  const result = await client.execute(RECONCILIATION_WITHDRAW_SQL,
    [input.reconciliationId, input.departmentId, input.now, input.actorUserId, input.reason]);
  const row = result.rows[0] ?? {};
  if (Number(row.withdrawn) === 1 && Number(row.audited) === 1) return "withdrawn";
  if (Number(row.withdrawn) === 0) return "not_submitted";
  // Unreachable inside one statement; never report an unaudited withdrawal as success.
  throw new Error("The withdrawal and its audit record did not match.");
}
