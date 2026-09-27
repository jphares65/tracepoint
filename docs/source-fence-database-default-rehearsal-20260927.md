# Database-default read-only fence rehearsal (2026-09-27)

Status: **SOURCE FENCE REPAIR BLOCKED**. This is a paid-project rehearsal of
the proposed database-level default, not a live-source freeze or authorization
to reopen maintenance.

Supabase's Postgres migration guide recommends
`ALTER DATABASE postgres SET default_transaction_read_only = true` for a
maintenance-window migration. PostgreSQL defines that setting as the default
for **new sessions**, not a mandatory read-only mode. A client can explicitly
start a `READ WRITE` transaction. Existing sessions also retain their prior
session default until drained/reconnected.

## Paid-project result

Project `reukdouvpshshvqnzsgw` was visibly attested in the Supabase dashboard
before SQL execution. The SQL Editor ran as `postgres` on database `postgres`.
Before the test, its session default was `off`, and counts were one department,
one Auth user, one Storage object, and 248 existing TracePoint fence triggers.
Those triggers were not changed or removed.

1. `ALTER DATABASE postgres SET default_transaction_read_only = true` succeeded.
2. `pg_db_role_setting` showed the exact database-wide setting as `true`.
3. A subsequent session reported `pg_settings.source=database`,
   `default_transaction_read_only=on`, and `transaction_read_only=on`.
4. In that state, the SQL Editor executed the following **without a data
   mutation**:

   ```sql
   BEGIN READ WRITE;
   SELECT jsonb_build_object(
     'default', current_setting('default_transaction_read_only'),
     'transaction', current_setting('transaction_read_only')) AS state;
   ROLLBACK;
   ```

   The result was `{ "default": "on", "transaction": "off" }`.
   This is a direct, authenticated admin/import writer path around the proposed
   database-default fence. The existing per-table rehearsal triggers may still
   reject a subsequent write, but the database-level default alone does not.
5. The setting was changed back to `false`, then `ALTER DATABASE postgres RESET
   default_transaction_read_only` removed the temporary database-wide override.
   Final verification showed `default=off`, no database-wide setting, and the
   same one department, one Auth user, one Storage object, and 248 fence triggers.

No live production setting, data, maintenance rule, or capture was changed.
No rehearsal data row or object was changed. Since the required all-writer
invariant failed at this explicit SQL writer, it would be unsafe to claim that
unexercised Auth/Storage, background, RPC, or REST paths prove a complete fence.
The proposed database-level default must **not** replace the blocked
244-trigger procedure in the production cutover runbook.

The pinned production source was inspected separately in a TLS-verified,
read-only catalog transaction. Database `postgres` is owned by `postgres` and
still accepts connections. The configured migration-reader role itself has
`default_transaction_read_only=on`; that role-level setting is not evidence
of a database-wide freeze. The production catalog exposed only role-specific
read-only settings for `supabase_read_only_user` and
`tracepoint_migration_reader`, and aggregated active `authenticator`,
`pgbouncer`, and `supabase_admin` sessions. The read-only probe cannot prove
the SQL Editor's actual `ALTER DATABASE` or backend-termination rights, nor
can it prove every pooled connection has reconnected. No live DDL was attempted.

Next required step: establish an enforceable, supported fence that prevents
explicit `READ WRITE` overrides on every authoritative writer, or a composite
control that separately and demonstrably blocks that path while preserving
capture. Rehearse full writer-family negatives, capture, and reversal before
preparing a new production activation procedure. Do not interpret a new-session
default or a partial external API probe as full write-authority isolation.
