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

## Exit criteria

All schema objects match; validation plan passes; backup restore is proven;
connection exhaustion and failover are tested; every privileged route passes
cross-agency negative tests; audit events retain subject/actor continuity; two
rehearsals meet the downtime objective; rollback is timed and witnessed.
