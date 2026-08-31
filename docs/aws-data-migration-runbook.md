# PostgreSQL data migration runbook

This is a dormant engineering procedure. It does not authorize database access,
export, DMS creation, schema application or cutover.

## Preparation

1. Freeze repository migrations; export live metadata only under separate
   approval and diff it against `supabase/migrations`.
2. Record source/target PostgreSQL versions, extensions, encodings, collations,
   roles, grants, RLS, functions, triggers, views, indexes and sequences.
3. Classify tables by department ownership, global reference data, Auth coupling,
   append-only audit data and object metadata.
4. Create a versioned migration ledger with checksum, forward SQL, validation
   SQL, owner, duration and rollback classification. Never edit an applied file.
5. Regenerate `aws-supabase-access-inventory.json`; manually disposition every
   service-role call without a same-statement department filter and every browser
   query. Static flags are review inputs, not vulnerability findings.
6. Group conversion by bounded context in the wave order documented in
   `aws-data-access-inventory.md`; Auth remains last.

## Target controls

- Private database subnets, TLS-required connections, no public endpoint.
- Separate owner/migrator, application read-write, read-only validation and
  break-glass roles. Application cannot own schema or bypass RLS by default.
- Secrets Manager rotation with alternating credentials where supported; short
  overlap, pool refresh and forced old-credential revocation.
- RDS Proxy only after transaction/session-state compatibility testing; otherwise
  application pooling with bounded connections and transaction pooling rules.
- Automated backups/PITR, deletion protection and retained final snapshot policy
  selected before real data. Restore tests define whether backups are usable.

## Rehearsal

1. Build empty target from ordered SQL in a disposable isolated environment.
2. Replace Supabase `auth.uid()`/`auth.role()` with transaction-local subject and
   claims settings set by the trusted data layer; deny when absent.
3. Load synthetic data exercising every FK, RLS path, workflow state and large
   object-metadata case.
4. For approved staging export, use native `pg_dump`/`pg_restore` or DMS only
   after testing types and transformations. Exclude Supabase-managed schemas
   unless explicitly mapped.
5. Disable user triggers only where the load plan proves derived values are
   restored separately; always re-enable and verify before access.
6. Rebuild/validate indexes, constraints and materialized state; `ANALYZE`.
7. Reconcile each owned sequence with `max(id)`/identity state without decreasing it.
8. Review every security-definer owner, execute grant and fixed `search_path`;
   map each `auth.uid()` reference to deny-by-default transaction-local subject
   claims. Preserve transactional workflow RPCs until equivalent locking,
   invariant, error and audit tests pass.

## Cutover design

Use multiple rehearsals, then: announce freeze; stop background dispatch/imports;
block writes; capture final source LSN/time; apply delta/CDC; reconcile counts,
checksums, FKs and sequences; run tenant/auth smoke tests; switch a canary using a
new immutable deployment; monitor; then widen. Supabase remains intact and
read-only during the rollback window.

## Rollback

Rollback before new-target writes by switching connection/provider configuration
back to Supabase. After target writes begin, automatic reverse replication is not
assumed: stop writes, preserve both sides, reconcile the target delta, and obtain
incident/data-owner approval before replay. Never discard either database during
the retention window.

Read-only conversion rolls back per route by selecting the still-authoritative
Supabase repository. Comparative dual-read may emit redacted equality metrics but
must not return mixed-source results. Do not dual-write: idempotency, ordering,
reconciliation ownership and reverse replay are not solved.

## Exit criteria

All schema objects match; validation plan passes; backup restore is proven;
connection exhaustion and failover are tested; every privileged route passes
cross-agency negative tests; audit events retain subject/actor continuity; two
rehearsals meet the downtime objective; rollback is timed and witnessed.
