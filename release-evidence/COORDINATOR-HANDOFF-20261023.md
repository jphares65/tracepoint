# Handoff to the Batch 2 release coordinator (2026-10-23)

From the verification and evidence-support workstream (this session does not deploy, apply migrations or change production). The owner decided on 2026-10-23 that the Batch 2 deployment conversation is the **sole release coordinator**, and that the agreed candidate is `claude/integration-batch2-20261022` @ `3329411a`, or a newer verified successor from the coordinator.

## 1. Lineage verification (accepted by the owner as supporting evidence)

Full record: [`LINEAGE-VERIFICATION-20261023.md`](LINEAGE-VERIFICATION-20261023.md). In short:

- **Migrations:**
  - 001–063 on `3329411a` are byte-identical to staging's applied files (63/63 git blobs), and production's 001–048 are the same files.
  - 064/065 are `c844398`'s 055/056, with only the audit text naming the number changed.
  - `c844398` must not be deployed: its numbering diverges from 038 on.
- **Functionality preserved:** a three-way comparison (merge base `5b9ec98`, candidate, staging) found no lost change. The differences are renumbering, D-3/D-4, test headers, release tooling and the sidebar commit (`6221e338`, production's only extra commit).
- **Rollback (G7), the deployed versions' own suites with the later migrations added:**
  - `4531104` with 064–065: 1117 pass, 0 fail, and its bootstrap passes;
  - `5700011` with 049–065: 890 pass, 0 fail.
  - `5700011`'s own bootstrap fails even with nothing added (its Supabase set lacks `202609100001_complete_module_tables.sql`). This is a pre-existing limitation, not a regression.
- **Production range hotfix `933db17a`:** not merged. Its tenant protection is present in `3329411a` (filtered GETs, PUT boundary and merge). Its `tracepoint_range_foreign_records_withheld` log line and its read-only scan SQL are missing; whether to carry them is the coordinator's decision.

## 2. Live production database inspection: requirements

**Why.** The production `status` path (and `migrate-db.ps1 production -Action status`) runs from the migration bootstrap task, whose credentials target the **pre-cutover** instance (`apply-app-migrations.ps1`, comment above `$liveInspection`). The 16 October "absent" ledger report is therefore not evidence about the live database. Only `-Action inspect` reads the live instance.

**The approved action, exactly:**

```powershell
.\scripts\apply-app-migrations.ps1 -Environment production -Action inspect -ImageCommit 5700011cc9ea6cff880bcb7f697423fa7f4fd27c
```

Run it from a clean checkout of `3329411a`. Never add `-AuthorizeLiveDatabaseChange`, `-ApplicationImageDigest` or `-MigrationSourceCommit`; they select the change or release lanes.

**What it does** (verified in the script at blob `376219cc…`):
- `inspect` is neither a release-lane action nor a live-database-change action;
- it asserts the production identity (`TracePointMigrationProduction`), that the running service uses the pinned live runtime secret, that the secret has had a single version since attestation, and that the pinned host is the live RDS endpoint;
- it reuses the deployed application image for `5700011` and builds nothing;
- it registers one revision of `tracepoint-production-live-database-inspect`, with no task role and the running application's least-privileged credential, then runs one Fargate task;
- the runner opens `BEGIN TRANSACTION READ ONLY` and returns the ledger rows (`version`, `filename`, `content_sha256`) and a schema catalog (relations, columns, routines, indexes, constraints, policies, privileges, roles, triggers), plus mobile API dependencies.

**What it must not do:** apply migrations, use the owner credential, change records, build or push images, or touch the application service.

**Guarded procedure for the owner's workstation:** [`Invoke-LiveProductionInspection.ps1`](Invoke-LiveProductionInspection.ps1) (Windows PowerShell 5.1, paths `C:\Users\jphar\tracepoint` and `C:\Users\jphar\tracepoint-release-evidence-20261022-140702`). Its steps:
1. Fetch, and verify that `3329411a` is on the Batch 2 branch, that `5700011` is local, and that the reviewed script blob is the one checked in.
2. Use a clean detached worktree; the main checkout is untouched.
3. Before anything runs, require production to be in the evidence state: task definition `tracepoint-production:30`, digest `sha256:c5ab4e1f…bc7c2`, no rollout in progress, and the `5700011` image tag resolving to that digest.
4. Run only the command above.
5. Compare the service before and after (status, task definition, desired count, deployments, running digests) and stop if anything differs.
6. Check the task that ran: family, command `inspect production`, no task role, the expected image, a single runtime secret, the pinned host, exit code 0.
7. Read the task's log stream, paged, into the evidence folder, with a SHA-256 manifest.

**Nothing is committed or pushed.** The owner hands the folder `production-live-inspection-<UTC stamp>` to the coordinator.

## 3. For the coordinator to decide from the inspection

1. Compare each live ledger row with `3329411a`'s `database/aws` file of that version (filename and SHA-256 exactly; the bytes are the deployed `git archive` output, so compare with the deployed archive or blob as appropriate).
2. If the ledger is absent or partial on the live instance: decide whether the documented history adoption (030–037, `aws-native-production-ledger-adoption.mjs`) and the guarded live owner actions for 038–048 come before 049–065.
3. Compare the catalog with what 049–065 assume. This covers functions and grants touched by 049–065, and the reconciliation, custody and inventory objects 064/065 extend.
4. Then confirm rollback compatibility for production on the live schema shape, and tenant isolation in the release verification (cross-agency checks; range GET filtering).

## 4. Still open (unchanged)

- **R-WD-1:** a dedicated, database-enforced reconciliation-withdrawal permission. At the database level any `manage_firearms` holder can withdraw (052 policy, `audit_events_insert_managers`). No application route withdraws without the administrator check, a reason and an audit record. Tracked in `docs/uiux-audit-20261022/remediation-plan.md` §11.
- **C33** (native client contract for unanswered inspection items) is unverified without a native build.
