# Staging preflight: read-only kit

For `STAGING-VERIFICATION.md` §0a gates G2–G5, §1 and the "after applying" check in §2. Candidate code commit `8574db3`. Pending set: `database/aws` 038–046 and 048–053 (15 files, no 047).

**Status:** the kit was rehearsed locally on synthetic data only (see "Local rehearsal"). It has **not** been run against staging.

| File | Purpose |
|---|---|
| `staging-preflight-readonly.sql` | psql script. Every statement is a `SELECT`, grouped into `begin transaction read only; … rollback;` blocks, one block per gate. No temporary tables, no `SET`, no `set_config`. sha256 `f1678cfdda8b55ad81e4dd335b3f4b54eecfb1d28ef9225d99e3328719570be0`. |
| `scripts/qualification-status-snapshot.sql` + `scripts/qualification-status-diff.mjs` (repository) | G4d, the B10 per-officer report. Run separately (step 4). The output contains names. |

## 1. Connectivity: there is no psql path in the repository

`scripts/migrate-db.ps1` never gives the workstation a database connection. It is not a psql path. What it does:

1. Checks the AWS identity: account `559054714699`, role `TracePointMigrationStaging`, profile `tracepoint-member-staging`.
2. Requires a clean commit and checks that the SHA-tagged application image exists in ECR with a clean scan.
3. Calls `scripts/apply-app-migrations.ps1`, which:
   - builds or reuses the image `migration-<sha>-aws-native-staging`;
   - registers a copy of task definition `tracepoint-staging-database-bootstrap:27` with that image;
   - injects one secret, `TRACEPOINT_DATABASE_SECRET_JSON` from `tracepoint/staging/database/migrator`. This is the RDS master login `tracepoint_migrator`, which owns the schema;
   - runs the container command `scripts/run-aws-native-migrations.mjs <status|apply> staging` as a Fargate task. The task uses the network configuration of the `tracepoint-staging` ECS service.
4. Inside the task, the node runner connects with TLS to the RDS CA `/app/rds-ca.pem` and prints its JSON report to the task log.

The database itself (`infra/lib/staging-database-stack.ts`) sits in `PRIVATE_ISOLATED` subnets with `publiclyAccessible: false`. `infra/lib` defines no bastion and no port-forward host. The image runs only node: it contains `pg` but no `psql`, and it does not contain `docs/`.

**Consequences:**

- G2 is answered by the existing path. Use `.\scripts\migrate-db.ps1 staging -Action status` (§1 step 1). The kit's G2 cross-checks the same ledger.
- Running this kit (G3, G4, the after checks) needs a read path that does not exist yet. **That is an owner decision.** The closest option to the existing path is a one-shot Fargate task with the same shape as `Invoke-MigrationTask`:
  - the same cluster, the service network configuration and the migrator secret;
  - an image that contains `psql` 16 or later, this file and the RDS CA;
  - the kit run with the command in §2, writing its output to the task log.

  This is a new task definition and image, which is an infrastructure action. Do not improvise it during the deployment window.
- Whatever path is chosen, connect as **`tracepoint_migrator`**. Two reasons:
  - G3.5 compares object owners with that role.
  - The counts in G4 must not be filtered by RLS. The owner bypasses RLS; the rehearsal found no table with `FORCE ROW LEVEL SECURITY`.

  The runtime role would return RLS-filtered counts. The SSO role only authorizes the AWS side; there is no IAM database authentication.

**Engine version:** `infra/lib/staging-database-stack.ts` pins **PostgreSQL 18.4**, not 17. The rehearsal ran on PostgreSQL 16.15, the newest version available locally. The kit uses only catalog views and functions that are stable from 16 to 18: `pg_policies`, `pg_trigger`, `aclexplode`, `to_regprocedure`, `pg_get_functiondef` and `pg_attribute.attnotnull`.

## 2. How to run

```sh
# once a connection exists (any path), as tracepoint_migrator, TLS verified:
PGOPTIONS='-c default_transaction_read_only=on' \
psql "host=<rds-endpoint> port=5432 dbname=tracepoint user=tracepoint_migrator sslmode=verify-full sslrootcert=rds-ca.pem" \
  -X -f docs/remediation/preflight/staging-preflight-readonly.sql > preflight-<before|after>.txt 2>&1
grep -n ERROR preflight-<before|after>.txt   # must print nothing
```

- `PGOPTIONS` makes the session refuse any write, in addition to the per-block `read only`.
- Leave `ON_ERROR_STOP` unset, so a failing gate does not hide the others. Any `ERROR` line is a NO-GO until explained.
- Check the file first:
  - `sha256sum` must match the value above;
  - `git show <deploy-sha>:docs/remediation/preflight/staging-preflight-readonly.sql | diff - <file>` must print nothing.

Order on the day:

1. **Before the RDS snapshot (G5):** run the kit and save the output as "before".
2. Record G2 with `migrate-db.ps1 staging -Action status` as well.
3. Take the G5 snapshot. It is not SQL: `tracepoint-staging-pre-integration-<date>`, `available`, ARN recorded.
4. Run the B10 report (G4d). It contains names, so keep it inside the authorised environment and delete it afterwards:

   ```sh
   psql "<same connection>" -X -At -v department_id= -f scripts/qualification-status-snapshot.sql > snapshot.json
   node --import tsx scripts/qualification-status-diff.mjs snapshot.json --before <commit of the image now on staging>
   ```

   - `--before` is the code currently deployed: the rollback-target image's commit. `7f7f85f` in the B10 record is that batch's base, not staging's.
   - Run the diff from a checkout of `8574db3`, or of the deploy SHA.
5. Run `migrate-db.ps1 staging -Action apply`, then `-Action status`.
6. Run the kit again and save the output as "after". Compare it with "before".

## 3. What each output must show for GO

The "Rehearsal" column holds the synthetic values. They only show the shape of the output; staging numbers will differ.

| Section | GO (before apply) | GO (after apply) | Rehearsal 037 → 053 |
|---|---|---|---|
| SESSION | `current_user` = `tracepoint_migrator`, `transaction_read_only` = `on`, database `tracepoint` | same | as expected |
| G2.2 | Rows 1–37 "applied, hash matches"; rows 38–46 and 48–53 "pending"; no `DRIFT` row | every row "applied, hash matches" | as expected |
| G2.3 | `37 / 37 / 0 / 15 / 0`, latest 37 | `52 / 52 / 0 / 0 / 0`, latest 53 | 37/37/0/15/0 → 52/52/0/0/0 |
| G3.1 | all `t` (`tracepoint_runtime`, `authenticated`, `anon`, `service_role` are named by GRANT/REVOKE in 039–053; a missing role makes that file fail) | same | all t |
| G3.2 | all `t` (objects of 028–031 and 033–037) | same | all t |
| G3.3 | all `t` (62 existing tables and functions that 038–053 reference or replace) | same | all t |
| G3.4 | all `t` | same | all t |
| G3.5 | every row `owned_by_migrator` = `t`. If a row is `f`, the file that alters that object fails, and the files before it stay applied. 041 needs `equipment_assets` and `equipment_asset_assignments` (§1 step 3). | same | all t |
| G3.6 | `grantor_is_owner` = `t` on every row. A grant made by another role survives the REVOKE in 039, 052 or 053, so A.3 or A.5 would then fail. | no INSERT/UPDATE/DELETE rows for `authenticated` on either history table; no `authenticated` EXECUTE on `create_department_with_owner` | t → empty |
| G3.7 | all 13 `t`. If one is `f`, staging names that policy differently and the old permissive policy would survive next to the new one: **stop**. | 048 "member" rows and the 053 row `f`; `attachments_select`, `profiles_select_self_or_department_admin` and `ammunition_reconciliations_update` `t` | 13 t → 9 f, 3 t, 1 f |
| G3.8 | SELECT/ALL policies are only the G3.7 names plus `*_manage_training` | the 14 rows in the rehearsal "after" output (`*_select_own_or_authorized`, `range_packets_select_authorized`, `attachments_select`, the profiles policy, `*_manage_training`) | as expected |
| G3.9 | advisory: "matches 037 rehearsal" or "differs (inspect)". A missing column used by 038–053 is NO-GO; an extra column is fine. | "matches 053 rehearsal" for `fleet_vehicles`, `personal_rifles`, `training_certifications` and `fleet_audit_outbox` | 52 match + outbox absent → 53 match |
| G4a | record the per-agency counts; `newly_held_now_available_or_attention` is the visible change (S12, F6a) | unchanged, and the `baseline_cleared` total equals A.1 | A: 8/7/1/2/4/2, B: 2/2/1/0/1/1; A.1 = 2 |
| G4b | record the constraint definition and lifecycle counts; G4b.2: items held by inactive members (S19) | the definition includes `out_of_service` | 2 items |
| G4c | record Q1–Q9. **Q3 Pending rows are the false-"Expired" emails: the dispatcher stays off.** | unchanged by the migrations | Q1 3+1, Q3 Pending 3 |
| G4d | B10 report recorded and shared for the announcement; completed range days closed out first | snapshot inputs unchanged; status changes come from the image | 4 changes in B (B, C, D, G); identical before/after |
| G4e | B7 drift list reviewed by the coordinator; ARM-23 stale drafts listed (B8 record) | — | 4 events; 0 drafts |
| G4f | R0: `TimeZone` UTC (`UTC` or `Etc/UTC`), `DateStyle` `ISO, MDY`, `IntervalStyle` `postgres`, and no `pg_db_role_setting` row that overrides them for `tracepoint_runtime`; R1–R6 recorded | same | as expected |
| G4g | Pending counts per agency and kind recorded | **equal to before**. The migrations enqueue nothing. New rows appear only once the new image runs (DC2 fingerprint note), so record them again after S24. | 3 Pending → 3 |
| G5 | snapshot ARN, `available` | — | n/a |
| A.1 | 0 / 0 | `baseline_audit_rows` = G4a `baseline_cleared` total | 0 → 2 / 2 |
| A.2 | all `f`, no trigger rows | all `t`; 9 triggers | as expected |
| A.3 | — | `f, f, f, f, 0` | t on firearm before → f f f f 0 |
| A.4 / A.5 / A.6 | — | `t`; `f, t`; all `t` | as expected |

## 4. Results (fill in)

| Section | Before: date / operator | Before result | After: date | After result | GO? | Evidence link |
|---|---|---|---|---|---|---|
| Kit sha256 / deploy SHA | | | | | | |
| `migrate-db.ps1 status` (G2) | | | | | | |
| G2.2 / G2.3 | | | | | | |
| G3.1–G3.4 | | | | | | |
| G3.5 owners | | | | | | |
| G3.6 grantors | | | | | | |
| G3.7 / G3.8 policies | | | | | | |
| G3.9 fingerprints | | | | | | |
| G4a 046 preview | | | | | | |
| G4b lifecycle / inactive holders | | | | | | |
| G4c Q1–Q9 (Q3 Pending) | | | | | | |
| G4d B10 report | | | | | | |
| G4e B7 drift / ARM-23 drafts | | | | | | |
| G4f DC2 R0 / R1–R6 | | | | | | |
| G4g email queue Pending | | | | | | |
| G5 snapshot ARN | | | | | | |
| A.1–A.6 | | | | | | |

## 5. Local rehearsal (synthetic; no AWS or network calls)

Scratch worktree at `8574db3`. PostgreSQL 16.15, non-root, disposable, port 55666.

**Build: the "staging state"**

- Supabase lineage plus `database/aws` 001–028, then ownership of `public`, `tracepoint_auth`, `auth` and `storage` handed to a local non-superuser `tracepoint_migrator`, as on RDS.
- Then `scripts/run-aws-native-migrations.mjs` itself, through a local shim. Only `connect()` (local trust login as `tracepoint_migrator`) and the migration directory differ.
  - `baseline` recorded 001–028.
  - `apply` ran 029–037.
  - The ledger hashes equal `git show 8574db3:<file> | sha256sum`.
- Seed: two agencies, with members including two inactive, fleet, equipment, firearms, personal rifles, off-duty requests, ammunition, range workspaces, training and notifications.

**Results**

| Step | Result |
|---|---|
| Kit at 037 (`PGOPTIONS` read-only, `ON_ERROR_STOP=1`) | Runs, 0 errors |
| B10 report before | Agency B: 4 changes, matching the B10 record |
| Runner `apply` | Applied 038–046 and 048–053 in order, one transaction each, with ledger rows. No errors as the non-superuser owner. |
| Runner `status` after | No pending files, no drift |
| Each file applied once more | 0 errors. A full `pg_dump` before and after is identical. |
| After checks | 046 cleared exactly the 2 vehicles the preview counted, with 2 audit rows (actor null). B10 snapshot inputs and report identical before and after. B8/B8a queries: 3 triggers; false, false; 2 triggers; 0. 041 owners `tracepoint_migrator`. R0 UTC / ISO, MDY / postgres. |
| Runtime spot checks (`tracepoint_runtime` → `authenticated`) | Direct firearm-history insert: 42501. `change_firearm_status`: one row, actor = session. Chief approval writes "Chief Approved" with the note, and `workflow_note` is null. A critical inspection takes an Available vehicle Out of Service. Clearance with an open critical work order: 55000. |
| Kit at 053 | Runs, 0 errors |
| `db:validate-bootstrap` (shim, fresh cluster) | "79 ordered migrations and 52 AWS-native migrations" passed |

**Static check:** outside comments, string literals and psql meta-commands, the file contains no `insert`, `update`, `delete`, `merge`, `create`, `alter`, `drop`, `grant`, `revoke`, `truncate`, `copy`, `set`, `set_config`, `lock`, `do`, `call`, `execute`, `into`, `nextval`/`setval` or advisory-lock call. The statements are 47 `select`, 5 `with … select`, 9 `begin transaction read only` and 9 `rollback`.

## 6. Notes from the rehearsal for the operator and owner

- **Rollback SQL (§5 of `STAGING-VERIFICATION.md`).** Forward rollbacks were written from the records and applied to copies of the post-apply database: 046 (F3/F6a), 051 (B10) and 052+053 (B8/B8a). Each runs cleanly on its own.
  - Applied in reverse order, each rollback leaves the catalog identical to a database built without the rolled-back files, except for the items the records say may stay:
    - the 046 columns and their foreign key;
    - `personal_rifles.workflow_note`;
    - `range_workspace_scorer_roster_change_allowed`.
  - **One gap:** the B8a record restores only INSERT on `firearm_status_history`. At 037, `authenticated` also held UPDATE and DELETE. These have no policy, so they are inert. Add `grant update, delete` if an exact restore is wanted.
  - **One record instruction to reconsider:** "re-grant INSERT on `personal_rifle_status_history` with the B8 policy". On staging (037) that grant never existed: rifle history was already SELECT-only, which is the B8 finding. Re-adding it would create the over-wide policy that B8a-1 removed. To restore the pre-integration image's behaviour, leave it out. The rehearsed rollback did, and its write behaviour matched 037: firearm-history insert ok, rifle-history insert 42501.
- **REVOKE depends on the grantor (G3.6).** 052 and 053 revoke history writes, and 039 revokes `create_department_with_owner`. A REVOKE by the owner removes only the owner's grants. If staging's grants were made by another role, the revoke is a silent no-op.
- **048 depends on policy names (G3.7).** It drops the old member-wide policies by exact name. A differently named policy would survive and keep reads member-wide.
- **The B8 record's step-2 query expects `true`.** It is superseded by B8a, which expects `false, false` (A.3).
- **The 046 baseline also writes accountability audit rows.** The update of each cleared vehicle fires the existing `fleet_vehicles` accountability trigger, so DC2 R2 counts grow by more than A.1.
