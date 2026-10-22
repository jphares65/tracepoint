// Save Draft and Submit for an ammunition reconciliation (C-R1 follow-up, owner
// release blocker). Only a Draft is edited. On AWS-native the status check,
// the item rows and the parent update run in one transaction holding the
// reconciliation's row lock, so a competing Save Draft or Submit waits, then
// sees the committed status and gets a 409: it can neither return a submitted
// record to Draft, change its counts, nor overwrite another submission.
// Withdrawal stays a separate operation (reconciliation-withdraw.ts).

export type ReconciliationItemRow = {
  reconciliation_id: string;
  department_id: string;
  lot_id: string;
  expected_quantity: number;
  physical_quantity: number | null;
  variance: number | null;
  explanation: string | null;
};

export const RECONCILIATION_CONFLICTS = {
  Submitted: "This reconciliation is submitted and awaiting certification. Withdraw it to draft before changing the counts.",
  Certified: "Certified reconciliations cannot be changed.",
  changed: "Another person saved or submitted this reconciliation while you were editing it. Reload to see the current counts and status, then make your changes again.",
  cycleStarted: "Someone else just started this cycle's reconciliation. Reload to continue it.",
} as const;

/** Expected quantities come from the stored rows or the lots, never the browser. */
export function reconciliationItemRows(
  items: unknown[],
  ids: { reconciliationId: string; departmentId: string },
  storedExpected: Map<string, number>,
  lotQuantity: Map<string, number>,
): ReconciliationItemRow[] {
  return items.map((value) => {
    const item = (value ?? {}) as Record<string, unknown>;
    const lotId = String(item.lotId);
    const parsed = item.physicalQuantity === null || item.physicalQuantity === undefined || item.physicalQuantity === ""
      ? null
      : Number.parseInt(String(item.physicalQuantity), 10);
    const physicalQuantity = parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    const expectedQuantity = storedExpected.get(lotId) ?? lotQuantity.get(lotId) ?? 0;
    return {
      reconciliation_id: ids.reconciliationId,
      department_id: ids.departmentId,
      lot_id: lotId,
      expected_quantity: expectedQuantity,
      physical_quantity: physicalQuantity,
      variance: physicalQuantity === null ? null : physicalQuantity - expectedQuantity,
      explanation: typeof item.explanation === "string" && item.explanation.trim() ? item.explanation.trim() : null,
    };
  });
}

/** The 400 a submission gets for missing counts or unexplained discrepancies. */
export function submissionProblem(rows: ReconciliationItemRow[]) {
  if (rows.some((row) => row.physical_quantity === null)) return "Every ammunition lot requires a physical count before submission.";
  if (rows.some((row) => row.variance !== 0 && !row.explanation)) return "Every discrepancy requires an explanation before submission.";
  return null;
}

export type ReconciliationSaveOutcome =
  | { outcome: "saved" }
  | { outcome: "not_found" }
  | { outcome: "conflict"; status: string }
  | { outcome: "invalid"; error: string };

type Transaction = { query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
type TransactionalClient = { transaction<T>(operation: (client: Transaction) => Promise<T>): Promise<T> };

/** The AWS-native data client can run several statements in one transaction; the bridge client cannot. */
export function transactionalClient(admin: unknown): TransactionalClient | null {
  return admin && typeof (admin as TransactionalClient).transaction === "function" ? admin as TransactionalClient : null;
}

/** Runs inside the caller's transaction. Writes nothing unless the locked row is a Draft. */
export async function saveReconciliationLocked(tx: Transaction, input: {
  reconciliationId: string;
  departmentId: string;
  actorUserId: string;
  action: "save" | "submit";
  items: unknown[];
  notes: string | null;
  now: string;
  lotQuantity: Map<string, number>;
}): Promise<ReconciliationSaveOutcome> {
  const ids = [input.reconciliationId, input.departmentId];
  const locked = (await tx.query(
    "select status from public.ammunition_reconciliations where id = $1::uuid and department_id = $2::uuid for update",
    ids,
  )).rows[0];
  if (!locked) return { outcome: "not_found" };
  if (locked.status !== "Draft") return { outcome: "conflict", status: String(locked.status) };

  const stored = (await tx.query(
    "select lot_id::text as lot_id, expected_quantity from public.ammunition_reconciliation_items where reconciliation_id = $1::uuid and department_id = $2::uuid",
    ids,
  )).rows;
  const rows = reconciliationItemRows(input.items, input,
    new Map(stored.map((row) => [String(row.lot_id), Number(row.expected_quantity)])), input.lotQuantity);
  if (input.action === "submit") {
    const problem = submissionProblem(rows);
    if (problem) return { outcome: "invalid", error: problem };
  }

  await tx.query("delete from public.ammunition_reconciliation_items where reconciliation_id = $1::uuid and department_id = $2::uuid", ids);
  if (rows.length > 0) {
    await tx.query(
      `insert into public.ammunition_reconciliation_items
         (reconciliation_id, department_id, lot_id, expected_quantity, physical_quantity, variance, explanation)
       select $1::uuid, $2::uuid, x.lot_id, x.expected_quantity, x.physical_quantity, x.variance, x.explanation
       from jsonb_to_recordset($3::jsonb) as x(lot_id uuid, expected_quantity integer, physical_quantity integer, variance integer, explanation text)`,
      [...ids, JSON.stringify(rows.map(({ lot_id, expected_quantity, physical_quantity, variance, explanation }) =>
        ({ lot_id, expected_quantity, physical_quantity, variance, explanation })))],
    );
  }
  const submit = input.action === "submit";
  const updated = await tx.query(
    `update public.ammunition_reconciliations
     set notes = $3, updated_at = $4::timestamptz, status = $5,
         submitted_at = case when $5 = 'Submitted' then $4::timestamptz else null end,
         submitted_by = case when $5 = 'Submitted' then $6::uuid else null end
     where id = $1::uuid and department_id = $2::uuid and status = 'Draft'
     returning id`,
    [...ids, input.notes, input.now, submit ? "Submitted" : "Draft", submit ? input.actorUserId : null],
  );
  // Unreachable while the row lock is held; throwing rolls the item rows back.
  if (updated.rows.length !== 1) throw new Error("The reconciliation changed while it was locked.");
  return { outcome: "saved" };
}

/** A unique, microsecond-precision updated_at used as the bridge client's compare-and-set token. */
export function claimToken(now: Date = new Date()) {
  return now.toISOString().replace("Z", `${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}Z`);
}
