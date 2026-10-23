# Release lineage verification (2026-10-23)

This verifies the converged candidate `claude/integration-batch2-20261022` @ `3329411a` against the AWS evidence recovered on 2026-10-22. It is a verification only; nothing here is deployed or applied.

## Deployed versions (from the evidence summary, confirmed in git)

| Environment | Running commit | Task revision | Digest | Relation to the candidate |
|---|---|---|---|---|
| Staging | `453110419b5c` | 192 | `sha256:8a164d0b…5307` | An ancestor of `3329411a` |
| Production | `5700011cc9ea` | 30 | `sha256:c5ab4e1f…bc7c2` | `22e543d` plus one UI commit (sidebar), carried into the candidate as the equivalent patch `6221e338` |

Both commits are on GitHub (staging: `integration-baseline/batch2`; production: `integration-hotfix-range`), so no archive needs publishing.

## Migration lineage

- The candidate's 001–063 are **byte-identical** to staging's applied files (git blob comparison, 63/63). Production's 001–048 are the same files.
- Why `c844398` diverged: staging inserted Agency Documents and catalog work at 038–048 and renumbered the B0–B11 remediation from 038–053 to 049–063. 14 of those 15 files are byte-identical; 057 differs from `c844398`'s 046 only in the two strings that name its own number.
- 064/065 are `c844398`'s 055/056; only the audit text naming the number changed. They are pending everywhere.

## Functionality

| Check | Result |
|---|---|
| Files changed only by the candidate line and different in batch2 | Renumbering references, D-3/D-4 data-client relations (the new `transaction()` is kept), and test request headers |
| Files changed only by staging and different in batch2 | Release tooling, the sidebar commit, and test alignment |
| Production hotfix `933db17a` (other agencies' legacy range records) | Not merged. Its protection is covered: both range GETs filter with `workspaceForActiveDepartment`, and both PUTs enforce the tenant boundary and reattach protected records. Missing are its `tracepoint_range_foreign_records_withheld` log line and its read-only scan SQL. |
| Withdrawal and concurrency validators | Present in batch2's `validate-clean-bootstrap.mjs` |
| CI | Run 46 green on `3329411a` |

## Rollback compatibility (G7), run locally on 2026-10-23

Each deployed commit's own suite was run with the candidate's later migration files added byte for byte:

| Deployed commit | Migrations added | Own application suite | Own clean bootstrap |
|---|---|---|---|
| `4531104` (staging) | 064–065 | 1117 pass, 0 fail, 1 skip | Passes (80 + 65 migrations) |
| `5700011` (production) | 049–065 | 890 pass, 0 fail, 1 skip | Fails **without any addition**: its Supabase set has no `202609100001_complete_module_tables.sql`, so `202610020001` cannot find `attachments`. This predates the release and is not a regression. |

Supporting evidence for production: staging applied 049–063 while still serving `22e543d` (which equals production's code apart from the sidebar).

## Production ledger: what is still needed

The production `status` action uses the migration bootstrap task. Its credentials target the **pre-cutover** instance (`apply-app-migrations.ps1`, comment above `$liveInspection`). The 16 October "absent" report may therefore not describe the live database. The live ledger and schema come from `apply-app-migrations.ps1 production -Action inspect -ImageCommit 5700011…`. That action:
- runs a READ ONLY transaction on the live instance, pinned to its host and secret;
- reuses the deployed image and builds nothing;
- registers one revision in `tracepoint-production-live-database-inspect` and runs one task.
