# Final release candidate (2026-10-22): readiness and staging deployment plan

Branch `claude/integration-final-20261022`. The candidate SHA is the branch head
that carries this file; the CI run on that exact SHA is the evidence (section 4).
`claude/rc-inventory-c8f9b3c` (`c8f9b3c`) stays unchanged as the earlier,
separately tested candidate.

**Status: not deployable yet.** Gates G1 and G2 (section 2) need read access to
the staging and production AWS accounts. Nothing in this branch has been
deployed, and no database has been changed.

## 1. Composition

| Workstream | Commits (on top of the previous row) | Separately tested |
|---|---|---|
| UX-RB release safety (range merge, 5 review rounds) | through `4372945` | CI green on `2c073ae` |
| UX-RB2 pre-production batch (C33/C34 fleet) | through `7a39854` | CI green on `03081b0` |
| Custody (SV-28): ordinary transfer, temporary custody, recipients, storage-location permission, migration 055 | through `9e7551e`, `c8f9b3c` | CI run 31 (`9e7551e`), run 36 (`c8f9b3c`) green |
| Auth return path, notification acknowledgement | in `9e7551e` | run 31 |
| Inventory (D-62/63/65/70, C-07, C-32, C-48, D-14, D-22), migration 056 | in `c8f9b3c` | run 36 |
| Owner decisions: reconciliation withdrawal (permission, reason, audit); adjustment controls for authorized users only | `e43f7c7` | locally 1047/1047 |
| Settings SV-29 (E-02, E-04, E-06, E-07, AE-R1) | `1dfb993`, cherry-picked unchanged as `c0b4558` | CI run 37 green on `1dfb993` |
| Withdrawal and its audit in one statement (owner item 5) | `098bc42` | CI run 39 green on `a628e6c` |
| Save Draft / Submit concurrency (owner release blocker, section 5a) | this commit | this candidate |

Check: `4372945`, `7a39854`, `9e7551e`, `c8f9b3c` and `e43f7c7` are all
ancestors of the candidate. The Settings files equal `1dfb993` except
`SecureStorageLocationsPanel.tsx`, which keeps the custody workstream's
storage-location permission change.

## 2. Gates

| Gate | Status | Evidence / what is needed |
|---|---|---|
| G1 Migration ledgers (staging, production) | **BLOCKED** | Needs the `tracepoint_aws_schema_migrations` rows from both environments (section 3). The AWS credentials in the session environment are rejected (`InvalidClientTokenId`). |
| G2 Deployed image and source provenance | **BLOCKED** | Staging serves `22e543d` and production `5700011`. Neither commit is on GitHub. Needs `ecs describe-services` and `describe-task-definition` (image digest), plus the source of those commits. |
| G3 One integrated candidate | Done | Section 1. |
| G4 Full CI on the exact candidate | See section 4 | `Application quality gate`: lint, typecheck, the full test suite including the embedded-PostgreSQL custody, inventory and settings tests, and `validate-clean-bootstrap` (79 + 54 migrations and every `validate-local-*` check). |
| G5 Withdrawal under simulated failures | Done | Section 5. |
| G6 Open requirement R-WD-1 recorded | Done | Section 7, and the master remediation plan (`docs/uiux-audit-20261022/remediation-plan.md` §11 on `claude/tracepoint-uiux-audit-q2sbf2`). |
| G7 Rollback compatibility against the deployed image | **Partial** | The schema with 055 and 056 added passes the earlier release candidate `5b6cc00`'s full suite (833/833) and its bootstrap. The deployed `22e543d` cannot be tested until its source is available (G2). |

## 3. Migration collision resolution

**This candidate:** `database/aws` 001–053, `055_armorer_storage_location_permission.sql`
and `056_inventory_idempotency_and_recipients.sql`. 054 is not here: it exists
only on `claude/fix-b8a-contract-054` as `054_armory_history_contract.sql`.

| File | SHA-256 |
|---|---|
| 053_armory_audit_and_access.sql | `76f6af92b373f89051473064581bd9e71f0935209749045ce1a357324800067c` |
| 054_armory_history_contract.sql (branch only) | `d0bfe73bd75679cbb5d7495e3f87b4d59f7461df1020bbeb859aae63d57837a0` |
| 055_armorer_storage_location_permission.sql | `eb51fb63bbcf5e4343f495974c285d63cc6faade7920923c233a286a4b9ae390` |
| 056_inventory_idempotency_and_recipients.sql | `0bcb0e71299acb1a5fb553dd80970bdcb264304c737560021226b2c3cb88a74c` |

055 and 056 were written in this work and have been applied nowhere.

**The runner protects against a collision.** `run-aws-native-migrations.mjs`
`verifyLedger` throws `MIGRATION_DRIFT` if any recorded row's version has no
repository file with the same filename and SHA-256. If staging records
054–063 from source that is not in this repository, `status` and `apply` from
this candidate both stop before running any SQL. Nothing can be applied by
accident; the procedure below is still required.

**Reading the ledgers (read-only).** Run this on the owner's workstation (Windows
PowerShell, AWS SSO). Use a clean checkout of the **currently deployed** commit,
so the runner's own repository matches the ledger and its image is already in ECR:

```powershell
git checkout 22e543d   # staging's deployed commit
.\scripts\migrate-db.ps1 staging -Action status
git checkout 5700011   # production's deployed commit
.\scripts\migrate-db.ps1 production -Action status
```

`status` prints `applied[]` (`version`, `filename`, `content_sha256`,
`applied_at`, `application_git_sha`, `is_baseline`), `pending[]` and
`latestAppliedVersion`. Save both outputs, together with the `database/aws`
folders of those two commits.

**Decision once the ledgers are known.** No number is assumed before then.

1. Every recorded version, filename and SHA-256 is kept exactly as recorded.
   Applied files are added to this candidate byte for byte and never renumbered.
2. If the ledgers record nothing after 053 (or only a 054 whose SHA-256 matches
   the branch file), 055 and 056 stay as they are.
3. If the ledgers record 054–063 (or any version 055 or 056 with a different
   filename or hash), this candidate's 055 and 056 move to the next free
   numbers after the highest version recorded in either environment (for
   example 064 and 065). The references to update are:
   - `validate-clean-bootstrap.mjs` and `validate-local-storage-location-roles.sql`
     (055);
   - `inventory-idempotency-native.test.ts`, `recipient-directory.ts`,
     `inventory-server.ts` and `api/armory/inspections/route.ts` (056).
4. Each moved migration is reviewed against the applied 054–063 for overlap.
   This covers the same functions (`checkout_inventory`,
   `return_inventory_checkout`, `record_inventory_transaction`,
   `inventory_recipient_directory`), the same columns (`idempotency_key`) and
   the same grants (`firearm_custody.manage_storage_locations`). A conflict is
   resolved in our file, never in an applied one.
5. Validation, in CI and locally:
   - (a) `validate-clean-bootstrap` from an empty database through the full
     sequence;
   - (b) a **staging-prefix** run: the exact applied files up to the staging
     ledger's latest version, then only our pending files, followed by the
     same `validate-local-*` checks;
   - (c) the deployed image's own test suite (`22e543d`) against the schema
     after (b), for rollback compatibility (G7).

## 4. CI on the candidate

The workflow runs on every push to `claude/integration-**`. The run for the
candidate head is listed in the release report. If any job fails, the
candidate is not ready.

## 5. Reconciliation withdrawal under simulated failures (owner item 5)

**Defect found and fixed (`098bc42`).** The withdrawal and its audit row used
to be two writes, with a compensating revert if the audit insert failed. On
AWS-native, each data-client call is its own transaction. The 052 update
policy also refuses restoring another member's submission. So when an
administrator who was not the submitter hit an audit failure, the revert was
refused too. The reconciliation stayed withdrawn with no audit row, and the
response said it "stays submitted".

**Now:**
- On AWS-native, one statement (`RECONCILIATION_WITHDRAW_SQL`) locks the
  submission, withdraws it and inserts the audit row. It runs as the request's
  authenticated role under the existing policies (052 update, 20260721
  `audit_events_insert_managers`). Either both are written or neither is, and
  a mismatch is never reported as success. No schema change.
- The bridge client keeps the revert, checks that it worked, and otherwise
  reports and logs the inconsistency.

**Real-schema proof.** `scripts/validate-local-reconciliation-withdrawal.mjs`
is called by `validate-clean-bootstrap`. It runs the route's exact SQL, read
from the module, as `tracepoint_runtime` / `authenticated`:

| Case | Result |
|---|---|
| Old two-step revert | Refused by 052 (the defect, demonstrated) |
| Simulated audit-insert failure | Stays Submitted, no audit row |
| Simulated reconciliation-write failure | Stays Submitted, no audit row |
| Officer without `manage_firearms` | Withdraws nothing |
| Another agency's administrator | Withdraws nothing |
| Administrator | Draft, exactly one audit row (actor, reason, prior submitter and time) |
| Repeat on a Draft | Writes nothing |

A mutation check (the audit row removed from the statement) makes the
validator fail.

**Route tests** (`armory-integrity-route.test.ts`, "a withdrawal is never left
without its audit record") cover both clients under the same failures, plus
the reason and permission checks.

## 5a. Save Draft and Submit under concurrency (owner release blocker)

**Defect (in `a628e6c`).** Save Draft and Submit read the status, rejected a
Submitted record, then **deleted and reinserted the item rows** and finally
updated the parent with no status condition. A request that read Draft just
before another member submitted could still replace the submitted counts, and
(Save Draft) return the record to Draft with no reason and no withdrawal audit.

**Now.**
- **AWS-native (staging, production).** One transaction
  (`PostgresDataClient.transaction`, `saveReconciliationLocked`):
  1. `select … for update` locks the reconciliation;
  2. only a Draft proceeds; Submitted or Certified returns 409 before anything
     is written;
  3. the stored expected quantities are re-read under the lock;
  4. the items are deleted and reinserted;
  5. the parent is updated with `status = 'Draft'` as its condition.

  A competing request waits on the lock, then sees the committed status. It
  cannot return a submission to Draft, change its counts, or overwrite another
  submission; it gets an actionable 409. Any failure rolls the item rows back.
  No schema change.
- **Bridge client (Supabase, no request transaction).** Compare-and-set on
  `updated_at`: the row is claimed (Draft, unchanged since read) **before any
  item row is touched**, and the final update requires the claim. A write that
  lands before the claim gets a 409 with nothing written. *Residual
  limitation:* two bridge requests whose claims both succeed in sequence while
  their item writes overlap cannot be fully serialized without a database
  function. Staging and production run AWS-native; the bridge client is the
  local development path.
- A concurrent start of the same cycle's reconciliation (unique cycle key) now
  returns 409 instead of 500.
- Withdrawal is unchanged: a separate operation that is administrator-only,
  requires a reason, and is audited in one statement (section 5).

**Real-PostgreSQL proof.** `scripts/validate-local-reconciliation-concurrency.ts`
is run by `validate-clean-bootstrap` on the fully migrated schema. It drives
the **real route handler and the real AWS-native data client** (row-level
security as `authenticated`) with real Armorer and Administrator role
assignments. A third connection holds the row lock so that the requests queue
deterministically:

| # | Case | Result |
|---|---|---|
| 1 | Save Draft queued behind a Submit | 409; status Submitted, submitter, notes and counts intact |
| 2 | Two Submits | The first wins; the second gets 409; submitter and counts are the first's |
| 3 | Save Draft or Submit on a Submitted record | 409; nothing changes |
| 4 | Withdrawal | Armorer 403; no reason 400; administrator 200 (status only, counts kept) with one `ammunition_reconciliation_withdrawn` audit row; the draft can then be edited |
| 5 | Audit history | Earlier rows never change; each race adds exactly one accepted save's audited writes (parent update, item delete/insert) by the winner; refused requests add nothing |

A mutation check (accepting a Submitted record under the lock) makes it fail.
Route tests cover the bridge compare-and-set (a competing write before the
claim, and after it), the outcome-to-status mapping of the transactional path,
and the concurrent cycle start. `PostgresDataClient.transaction` has its own
unit test (commit, and rollback on failure).

## 6. Staging deployment plan (only after G1, G2 and G4 pass)

All steps run from the owner's Windows workstation, on a clean checkout of the
**exact candidate SHA** (`git status` empty), using the canonical scripts
(AGENTS.md lanes A and B). There are no CDK, CloudFormation, IAM, Cognito or
other Lane C changes.

1. **Pre-flight (read-only).**
   - Record the staging service's current task definition ARN and image digest
     (`aws ecs describe-services --cluster tracepoint-staging --services tracepoint-staging`,
     then `describe-task-definition`). This revision is the rollback target.
   - Run `migrate-db.ps1 staging -Action status` and confirm the ledger equals
     the one used in section 3, and that `pending` lists only this candidate's
     two migrations.
   - Confirm an RDS snapshot newer than the start of the change window
     (automated or manual; taking a manual snapshot is an AWS action the
     owner performs).
2. **Publish the image without changing ECS:**
   `.\scripts\deploy-app.ps1 staging -PublishOnly`. The script builds the
   reviewed commit and pushes the immutable image, then waits for a clean ECR
   scan. Record the image tag and the `sha256:` digest it prints. That digest
   is the one deployed in step 4.
3. **Migrations (Lane B):** `.\scripts\migrate-db.ps1 staging -Action apply`.
   The runner applies only the pending migrations, in order (the 055 storage
   grant, then the 056 inventory expand-only change, or their renumbered
   equivalents), each with its ledger row. Then run `-Action status` again:
   `pending` must be empty and the SHA-256 values must equal section 3.
   Both migrations are additive, so the currently deployed image keeps
   running throughout (G7).
4. **Deploy:** `.\scripts\deploy-app.ps1 staging`. The script registers a
   task-definition revision copied from the live one with only the image
   changed, updates the existing service, and waits for stability. It then
   checks that every running task has the step 2 digest, that all active ALB
   targets are healthy, that `/api/health` responds, and runs the remote smoke
   test. It prints the rollback command.
5. **Authenticated verification**, with dedicated synthetic staging accounts
   (`acceptance-<UUID>` tenants, credentials from the managed test-credential
   store and never in chat), under real roles (Administrator, Armorer, a
   `manage_firearms`-only role, Officer, plus a second agency's Armorer):
   - **Storage locations:** Armorer and Administrator create, rename and
     deactivate. The `manage_firearms`-only role and the Officer see no
     controls and get 403. The second agency's Armorer cannot change them.
   - **Custody (SV-28):** check out to the assignee; give temporary custody
     to another active member, with the assignment unchanged; inactive and
     other-agency recipients are refused; check in to storage. Each step
     writes its custody event and audit row. There is no
     administrative-correction control.
   - **Reconciliation:** Armorer A1 submits and Armorer A2 certifies (S22g).
     With two browser sessions on the same Draft, A1 submits and then A2
     saves a draft: A2 gets the "submitted and awaiting certification" 409,
     and A1's counts stand.
     On a second submission, the Administrator withdraws it with a reason, and
     the audit log shows `ammunition_reconciliation_withdrawn` with that
     reason. An Armorer sees no Withdraw button, and a direct POST returns 403.
   - **Inventory:** Officer and view-only users see no Receive, Move,
     Issue/Adjust or Add Item controls, and direct POSTs are refused.
     Authorized users can issue and return. A double-submitted request is
     recorded once (idempotency key). The recipient list shows only active
     agency members.
   - **Settings (SV-29):** Off-Duty, Armory and Qualification Cycles each save
     with a visible result that stays after a refresh. A member's access save
     keeps their groups when the groups failed to load.
   - **Fleet:** an inspection with unanswered items returns 400
     `inspection_items_not_answered` (C33). Run the native client against
     staging, or record C33 as unverified.
   - **Sign-in:** a deep link returns to its page after Cognito sign-in, and
     `/\evil` and absolute URLs go to `/`.
   - Re-run S10 (tenant-negative).
6. **Rollback.**
   - **Image:** run
     `.\scripts\deploy-app.ps1 staging -RollbackTaskDefinitionArn <step 1 ARN>`.
     The deploy script also rolls back automatically on a failed rollout.
   - **Schema:** 055 and 056 stay. They are additive, and the previous image
     tolerates them (G7, which must be shown against `22e543d` before this is
     claimed). Removing the 055 grant, if wanted, is a recorded Settings
     change per agency, not a down-migration.
7. **Production.** Production follows the same steps, with two differences.
   `migrate-db.ps1` refuses production `apply`, so applying migrations needs
   the separately authorized production release execution. And `-PublishOnly`
   is limited to staging. Production is promoted only after step 5 passes in
   full on staging.

## 7. Open requirements carried forward

- **R-WD-1 Dedicated reconciliation-withdrawal permission (owner
  requirement).** Withdrawal is limited to `administer_department` as an
  interim measure (`RECONCILIATION_WITHDRAW_PERMISSIONS`), and is enforced
  only by the route. At the database level, any `manage_firearms` holder can
  write the withdrawal under 052 and `audit_events_insert_managers`. Closing
  R-WD-1 needs a Lane B migration that does three things: adds the permission
  to the catalog and grants it to the Administrator role by default; makes
  the 052 update policy, or a security-definer function, require it for a
  Submitted-to-Draft change; and switches the route and page to it. It must
  not be dropped.
- C33 native client verification; the admin custody-correction workflow
  (kept disabled); and the remaining items listed in the release report.
