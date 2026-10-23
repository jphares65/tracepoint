# Batch 3: D-2 and staging acceptance defects AT-1 to AT-4 (2026-10-23)

Branch `claude/fix-at-acceptance-defects`, stacked on `claude/fix-d2-equipment-condition-report`
(`f846a3a3`, D-2 and migration 066), which is stacked on Batch 2 (`f4e8588d`, live on staging).
Nothing here is pushed, deployed or applied.

The defects come from the signed-in staging acceptance of 2026-10-22
(`TracePointEvidence/staging-acceptance-20261022.md`). AT-1 and AT-2 were first fixed on
`claude/fix-at1-at2-20261022` (`fad53326`, `77e1a98c`, on the pre-Batch-2 baseline); that worktree and its
uncommitted release edits are left untouched. Its fixes are ported here, and extended where noted.

## Migration sequence

| Version | File | State |
|---|---|---|
| 001–063 | (staging lineage and defect remediation) | applied on staging |
| 064 | `064_armorer_storage_location_permission.sql` | applied on staging (Batch 2, `f4e8588d`) |
| 065 | `065_inventory_idempotency_and_recipients.sql` | applied on staging (Batch 2) |
| 066 | `066_equipment_condition_report.sql` (D-2) | pending, never applied |
| 067 | `067_firearm_custody_follows_assignment.sql` (AT-2, AT-4) | pending, never applied |
| 068 | `068_fleet_manual_status_under_safety_hold.sql` (AT-1) | pending, never applied |
| 069, 070 | reserved: B8a armory history contract, B6 notification job recipients | no file |

The custody fix was numbered 064 on `fad53326`. Staging's 064 is the armorer permission, so that
release would have stopped with `MIGRATION_DRIFT`; the fix takes 067. No applied file was edited; 064 and
065 are byte-identical to what staging recorded. 067 and 068 each carry their own `begin; … commit;`.

## Defects

| ID | Defect | Fix | Evidence (fails before, passes after) |
|---|---|---|---|
| AT-2 (High) | `firearm_current_custody` kept naming the officer of a returned assignment | 067: return releases custody (audited); Duty Only replaces stale custody; existing stale rows corrected (audited). **New:** a guard on the custody table: custody may only name the active assignment of the same firearm and agency, under a share lock, so a return racing a transfer, check-in/out or Duty Only either waits and releases, or the custody write is refused whole (40001) | `custody-follows-assignment-schema.test.ts` on the full 001–068 schema through `tracepoint_runtime → authenticated`: acceptance A5/A6, storage, agency boundaries, both races (with the guard disabled they leave the returned officer as holder); ported stub test |
| AT-1 (Medium) | A manual Available under a safety hold answered 200; the saved override kept the vehicle Out of Service after the hold was released | 068: a person's status change to Available/Attention under a hold is refused whole (55000) whatever sent it; automatic updates keep 057's behaviour; already-affected vehicles flagged for review, not changed. Routes check first and answer 409 (`safety_hold_active`), writing only the refusal's audit entry. Readiness refresh drops an override a hold supersedes. **Not ported:** `77e1a98c`'s in-route rollback, which wrote the whole previous row back and could overwrite a concurrent change | `manual-status-safety-hold-schema.test.ts` on the full schema (F8 fails without 068; F10–F13; a change waiting on a hold being recorded; the review flag); `fleet-integrity.test.ts` AT-1 cases. FLT-01's list-route test asserted the defect itself (200) and now expects 409 |
| AT-3 (Medium) | One email the queue refused made `GET /api/notifications` 500 on every load | Email is a side effect of reading the inbox: failures are counted, logged without address or content, reported as `emailQueue`; recipient is the member's profile address (the one the queue accepts); support mode queues nothing | `notifications-read-side-effects.test.ts`: four AT-3 cases fail on the previous route (the first with the original 500) |
| AT-4 (Low) | Armory refusals reached the officer as 409 "PostgreSQL data operation failed." | The data client passes through only a deliberate refusal (innermost frame a PL/pgSQL RAISE, valid SQLSTATE other than 42704, ≤ 200 chars); everything else stays generic. 031 raised one refusal with errcode `'409'`, not a SQLSTATE, so PostgreSQL replaced it with 42704; 067 redefines that function with 55000. The custody route maps every refusal to a plain message | Full-schema test through `PostgresDataClient` (fails with the previous client); `postgres-data-client.test.ts` pins what is and is not passed through |

D-2 (`d76470e9`, 066) is unchanged from its branch.

## Release unit

`release-entitlements-staging.ps1` applies 066–068 on a recorded 001–065 (or resumes after 066/067), pinned to
staging task revision **193** (Batch 2, `f4e8588d`, `sha256:57e18514…`). Typed confirmations: `APPLY 066-068`,
then `DEPLOY APPLICATION`.

**Rollback.** Image: `deploy-app.ps1 staging -RollbackTaskDefinitionArn <revision 193>`. Schema stays:
066 only adds a function the previous image never calls; 067 keeps the custody functions' signatures; under
068 the previous image's manual Available on a held vehicle is refused (500) instead of answered 200 with a
stuck override. 067's correction of stale custody rows and 068's review audit rows are not reversed.

## Production

Production runs `2ed13448` (range hotfix, task revision 31) with schema 027–034 applied and no ledger. The
production unit on `claude/prod-remediation-049-066` covers 049–066 only; 067 and 068 must be added to it
(and its precheck) before Batch 3 can be proposed for production. AT-3 and AT-4 are application-only; AT-3
affects production today (the same code since 024).
