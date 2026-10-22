// Runs only inside validate-clean-bootstrap's disposable local PostgreSQL,
// after the database/aws ledger. Owner decision C-R1: a submitted ammunition
// reconciliation is withdrawn only with its audit record. The route's own
// statement (RECONCILIATION_WITHDRAW_SQL, read from its module so the two
// cannot drift) runs as the runtime's authenticated role under the real
// policies (052 update, 20260721 audit_events_insert_managers) and triggers:
// - the earlier two-step write could not be undone: the 052 policy refuses
//   restoring another member's submission, so a failed audit insert left an
//   unaudited withdrawal;
// - an audit failure, a reconciliation-write failure, or an actor the audit
//   policy refuses leaves it submitted and unaudited;
// - an administrator's withdrawal and its audit row are written together; a
//   draft and another agency's submission are not withdrawn.
// The administrator-only rule is the route's (RECONCILIATION_WITHDRAW_PERMISSIONS);
// the database admits any manage_firearms holder (register R-WD-1).
import { readFile } from "node:fs/promises";

const department = "05700000-0000-4000-8000-00000000000a";
const otherDepartment = "05700000-0000-4000-8000-00000000000b";
const admin = "05700000-0000-4000-8000-0000000000a1";
const submitter = "05700000-0000-4000-8000-0000000000a2";
const officer = "05700000-0000-4000-8000-0000000000a3";
const otherAdmin = "05700000-0000-4000-8000-0000000000b1";
const reconciliation = "05700000-0000-4000-8000-0000000000c1";
const now = "2026-10-22T12:00:00.000Z";

async function withdrawStatement() {
  const source = await readFile("src/lib/armory/reconciliation-withdraw.ts", "utf8");
  const match = source.match(/export const RECONCILIATION_WITHDRAW_SQL = `([^`]+)`/);
  if (!match) throw new Error("RECONCILIATION_WITHDRAW_SQL not found");
  return match[1];
}

export async function validateReconciliationWithdrawal(client) {
  const sql = await withdrawStatement();
  const asRuntime = async (subject, agency) => {
    await client.query("set local session authorization tracepoint_runtime");
    await client.query("set local role authenticated");
    await client.query("select set_config('tracepoint.subject_id',$1,true), set_config('tracepoint.department_id',$2,true)", [subject, agency]);
  };
  const asOwner = () => client.query("reset role; reset session authorization");
  const withdraw = async (subject, agency = department) => {
    await asRuntime(subject, agency);
    await client.query("savepoint attempt");
    try {
      const row = (await client.query(sql, [reconciliation, agency, now, subject, "Recount requested"])).rows[0];
      await client.query("release savepoint attempt");
      return { ok: true, withdrawn: row.withdrawn, audited: row.audited };
    } catch (error) {
      await client.query("rollback to savepoint attempt");
      return { ok: false, error: error.message };
    } finally {
      await asOwner();
    }
  };
  const state = async () => (await client.query(
    `select r.status, r.submitted_by,
       (select count(*)::int from public.audit_events where entity_id = r.id and action = 'ammunition_reconciliation_withdrawn') as audits
     from public.ammunition_reconciliations r where r.id = $1`, [reconciliation])).rows[0];
  const expectSubmitted = async (label) => {
    const current = await state();
    if (current.status !== "Submitted" || current.submitted_by !== submitter || current.audits !== 0) {
      throw new Error(`${label}: expected submitted and unaudited, found ${JSON.stringify(current)}`);
    }
  };

  await client.query("begin");
  try {
    await client.query(`insert into auth.users(id,email) values ($1,'wd-admin@example.invalid'),($2,'wd-submitter@example.invalid'),($3,'wd-admin-b@example.invalid'),($4,'wd-officer@example.invalid')`, [admin, submitter, otherAdmin, officer]);
    await client.query("insert into public.profiles(id,full_name) select id,email from auth.users where email like 'wd-%' on conflict(id) do nothing");
    await client.query("insert into public.departments(id,name,slug) values ($1,'Withdrawal A','local-wd-a'),($2,'Withdrawal B','local-wd-b')", [department, otherDepartment]);
    await client.query("insert into public.department_memberships(department_id,user_id,is_active) values ($1,$2,true),($1,$3,true),($4,$5,true),($1,$6,true)", [department, admin, submitter, otherDepartment, otherAdmin, officer]);
    await client.query("insert into public.department_membership_roles(department_id,user_id,role_code) values ($1,$2,'administrator'),($1,$3,'armorer'),($4,$5,'administrator'),($1,$6,'officer')", [department, admin, submitter, otherDepartment, otherAdmin, officer]);
    await client.query(`insert into public.ammunition_reconciliations(id,department_id,cycle_name,cycle_year,cycle_start,cycle_end,status,created_by,submitted_by,submitted_at)
      values ($1,$2,'Fall',2026,'2026-09-01','2026-11-30','Submitted',$3,$3,'2026-10-20T10:00:00Z')`, [reconciliation, department, submitter]);

    // 1. The earlier two-step write: the withdrawal lands, the audit insert is
    // refused, and the 052 policy refuses putting another member's submission back.
    await asRuntime(admin, department);
    await client.query("savepoint legacy");
    await client.query("update public.ammunition_reconciliations set status='Draft', submitted_at=null, submitted_by=null where id=$1", [reconciliation]);
    let restoreRefused = false;
    try {
      await client.query("update public.ammunition_reconciliations set status='Submitted', submitted_by=$2 where id=$1", [reconciliation, submitter]);
    } catch (error) {
      restoreRefused = /row-level security/i.test(error.message);
    }
    await client.query("rollback to savepoint legacy");
    await asOwner();
    if (!restoreRefused) throw new Error("expected the 052 policy to refuse restoring another member's submission");
    await expectSubmitted("after the legacy demonstration");

    // 2. Simulated audit failure.
    await client.query(`create function pg_temp.fail_withdrawal_audit() returns trigger language plpgsql as $$
      begin if new.action = 'ammunition_reconciliation_withdrawn' then raise exception 'simulated audit failure'; end if; return new; end $$`);
    await client.query("create trigger zz_fail_withdrawal_audit before insert on public.audit_events for each row execute function pg_temp.fail_withdrawal_audit()");
    const auditFailure = await withdraw(admin);
    await client.query("drop trigger zz_fail_withdrawal_audit on public.audit_events");
    if (auditFailure.ok || !/simulated audit failure/.test(auditFailure.error)) throw new Error(`audit failure: ${JSON.stringify(auditFailure)}`);
    await expectSubmitted("after a simulated audit failure");

    // 3. Simulated failure writing the reconciliation.
    await client.query(`create function pg_temp.fail_reconciliation_write() returns trigger language plpgsql as $$
      begin raise exception 'simulated database failure'; end $$`);
    await client.query("create trigger zz_fail_reconciliation_write before update on public.ammunition_reconciliations for each row execute function pg_temp.fail_reconciliation_write()");
    const writeFailure = await withdraw(admin);
    await client.query("drop trigger zz_fail_reconciliation_write on public.ammunition_reconciliations");
    if (writeFailure.ok || !/simulated database failure/.test(writeFailure.error)) throw new Error(`write failure: ${JSON.stringify(writeFailure)}`);
    await expectSubmitted("after a simulated database failure");

    // 4. An officer without manage_firearms: the 052 policy hides the row, so
    // nothing is withdrawn and nothing is audited.
    const officerAttempt = await withdraw(officer);
    if (!officerAttempt.ok || officerAttempt.withdrawn !== 0 || officerAttempt.audited !== 0) throw new Error(`officer: ${JSON.stringify(officerAttempt)}`);
    await expectSubmitted("after an officer attempt");

    // 5. Another agency's administrator sees no submission to withdraw.
    const crossAgency = await withdraw(otherAdmin, otherDepartment);
    if (!crossAgency.ok || crossAgency.withdrawn !== 0 || crossAgency.audited !== 0) throw new Error(`cross-agency: ${JSON.stringify(crossAgency)}`);
    await expectSubmitted("after a cross-agency attempt");

    // 6. The administrator withdraws: one row changes, one audit row records it.
    const done = await withdraw(admin);
    if (!done.ok || done.withdrawn !== 1 || done.audited !== 1) throw new Error(`withdrawal: ${JSON.stringify(done)}`);
    const after = await state();
    if (after.status !== "Draft" || after.submitted_by !== null || after.audits !== 1) throw new Error(`after withdrawal: ${JSON.stringify(after)}`);
    const audit = (await client.query(
      "select actor_user_id, summary, previous_value, new_value from public.audit_events where entity_id=$1 and action='ammunition_reconciliation_withdrawn'", [reconciliation])).rows[0];
    if (audit.actor_user_id !== admin || audit.summary !== "Recount requested" || audit.previous_value?.submitted_by !== submitter ||
        audit.previous_value?.status !== "Submitted" || audit.new_value?.status !== "Draft") {
      throw new Error(`audit record: ${JSON.stringify(audit)}`);
    }

    // 7. A draft is not withdrawn again, and no second audit row is written.
    const again = await withdraw(admin);
    if (!again.ok || again.withdrawn !== 0 || again.audited !== 0 || (await state()).audits !== 1) throw new Error(`repeat: ${JSON.stringify(again)}`);
  } finally {
    await client.query("rollback").catch(() => {});
  }
}
