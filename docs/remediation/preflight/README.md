# Staging preflight: read-only kit

For `STAGING-VERIFICATION.md` §0a gates G2–G5, §1 and the "after applying" check in §2. Candidate code commit `70717ba` (on `claude/integration-defects-20261020` at `628b609`). Pending set: `database/aws` 038–046 and 048–053 (15 files, no 047, no 054).

Against `8574db3`, `70717ba` changes two pending files. 046 now settles outbox entries from an existing audit row (new column `fleet_audit_outbox.delivered_by_existing_audit`). 053 keeps the 037 `firearm_status_history` grants and the policy `firearm_status_history_insert_managers`. The kit's embedded hashes and its G3.6, G3.7, G3.9, A.3 and A.6 expectations follow `70717ba`. The procedure in §0 does not rely on those hashes: it computes every expected sha256 from `-ReleaseCommit` at run time.

**Only one version of each migration can ever be applied to staging.** The runner hash-checks every ledger row against the repository. Once a 053 is applied, a release with a different 053 fails with `MIGRATION_DRIFT`. So decide the 053 variant before anyone runs `-Action apply`.

**Status:** the kit and the in-task runner were rehearsed locally on synthetic data only (see §5 and §0.6). Neither has been run against staging.

| File | Purpose |
|---|---|
| `staging-preflight-readonly.sql` | psql script. Every statement is a `SELECT`, grouped into `begin transaction read only; … rollback;` blocks, one block per gate. No temporary tables, no `SET`, no `set_config`. sha256 `88ac30f3e79542a3138feff25968225100470dce9893dc64294dad27c733225b`. |
| `Invoke-StagingReadOnlyPreflight.ps1` | The owner's procedure (§0). It collects the AWS evidence and runs the kit in one-shot ECS tasks. Access is read-only except `ecs run-task`. Its output is a GO/NO-GO summary. It lives in `docs/`, so it is not part of the release image. |
| `scripts/qualification-status-snapshot.sql` + `scripts/qualification-status-diff.mjs` (repository) | G4d, the B10 per-officer report. Run separately (step 4). The output contains names. |

## 0. Run the procedure (owner workstation)

### 0.1 Commands

Use Windows PowerShell 5.1 or PowerShell 7, with the AWS CLI v2 and git on `PATH`. Run from the repository root of a clean checkout of this branch (`claude/staging-preflight-20261020`). Use the existing SSO workflow.

```powershell
Remove-Item Env:AWS_ACCESS_KEY_ID, Env:AWS_SECRET_ACCESS_KEY, Env:AWS_SESSION_TOKEN, Env:AWS_PROFILE -ErrorAction SilentlyContinue
git fetch origin                                   # the release commit must be on origin/claude/integration-defects-20261020
git status --porcelain                             # must print nothing
aws sso login --profile tracepoint-member-staging

# 1. Offline check (no AWS): forbidden-verb scan, kit sha256, chunking, size budget, release hashes
.\docs\remediation\preflight\Invoke-StagingReadOnlyPreflight.ps1 staging -ReleaseCommit 70717ba86e12e3780cfae7cd01c816506efdd4f7 -SelfTest

# 2. Print every AWS command without calling AWS
.\docs\remediation\preflight\Invoke-StagingReadOnlyPreflight.ps1 staging -ReleaseCommit 70717ba86e12e3780cfae7cd01c816506efdd4f7 -Plan     # -WhatIf does the same

# 3. The preflight ("before"), then again after migrate-db.ps1 -Action apply with -Phase after
.\docs\remediation\preflight\Invoke-StagingReadOnlyPreflight.ps1 staging -ReleaseCommit 70717ba86e12e3780cfae7cd01c816506efdd4f7
```

- `70717ba86e12e3780cfae7cd01c816506efdd4f7` is `70717ba`, the current candidate. For another candidate, use its full 40-hex SHA (`git rev-parse <short>`).
- Exit codes: 0 means GO, 2 means NO-GO, 1 means a self-test failure.
- **Duration:** about 10–15 minutes.
  - About 1 minute of describe/list calls.
  - The canary task alone: Fargate start, image pull, about 1 minute of SQL; 2–4 minutes.
  - The other chunk tasks run in parallel: 3–5 minutes.
  - Log retrieval: under 1 minute.
  - `-SelfTest` and `-Plan` take seconds.
- **Evidence** goes to `%USERPROFILE%\tracepoint-preflight-evidence\staging-<before|after>-<UTC timestamp>\` (or `-EvidenceRoot`). The script refuses a folder inside the repository.

**What to send back:** zip the evidence folder and send it.

- `summary.txt` and `summary.json` hold the verdict and each check.
- `kit-output.txt` holds the full kit output, in psql-like text.
- `chunk-*.json`, `chunk-*.log` and `chunk-*.txt` hold the parsed records and the raw log lines.
- `ecs-service.json`, `rds.json`, `notification-delivery.json`, `runner-revision.json`, `git.json`, `identity.json` and `kit-chunks.json` hold the AWS and repository evidence.
- `aws-commands.txt` lists every AWS command that was run.

`chunk-G4e*.txt` contains training event titles (B7). Share it with the coordinator only. Nothing in the evidence contains a secret: the database credential is injected by ECS inside the task and never reaches the workstation.

### 0.2 Guards (all before any AWS call that matters)

- `-Environment` must be `staging`.
- The script scans its own text for `update-service`, `register-task-definition`, `create-*`, `put-*`, `delete-*`, `cdk`, `cloudformation`, `iam`, `apply`, `start-build`, `codebuild` and `s3api`. The only skipped region is the marked allow-list, which holds data, not calls. Any hit stops the script.
- Every AWS call goes through one function, which refuses any service/operation outside a fixed list (§0.3).
- The working tree must be clean. The script prints the checkout commit, the release commit and the kit sha256.
- The kit is read from the committed blob (`git cat-file`, exact bytes). Its sha256 must equal the pinned value, and its git blob id must reproduce.
- `-ReleaseCommit`:
  - must exist locally and be on `origin/claude/integration-defects-20261020`;
  - its `database/aws` files after 037 must be exactly 038–046 and 048–053.
  The script computes each file's sha256 from that commit at run time. It reads 053 to decide whether that 053 revokes `firearm_status_history` writes (the contract variant) or keeps them (the expand variant, as in `70717ba`). G3.6, G3.7 and A.3 are judged on that.
- Credentials: the script refuses if `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` or `AWS_SESSION_TOKEN` is set, or if `AWS_PROFILE` or `AWS_DEFAULT_PROFILE` names another profile. It refuses if the profile's `sso_account_id`, `sso_role_name`, `role_arn` or `region` resolves to the production account `193644343389`, or if the profile chains through `source_profile`.
- STS: account `559054714699`, and an ARN matching `assumed-role/*TracePointMigrationStaging*/…`, the same regex as `deploy-app.ps1`. STS is checked again right before the first `run-task`.
- `run-task` is accepted only with a revision of the family `tracepoint-staging-database-bootstrap`, and only with overrides within the size budget.
- Notification delivery is only read, never changed (§0.4).

### 0.3 AWS calls (complete list)

All calls use `--profile tracepoint-member-staging --region us-east-1 --output json`.

| Call | Purpose |
|---|---|
| `aws configure get <key> --profile …` | Local config only, no API call: production-account guard |
| `sts get-caller-identity` (twice) | Identity guard |
| `ecs describe-services --cluster tracepoint-staging --services tracepoint-staging` | Current task definition and revision; deployments and rollout state; `deploymentConfiguration.deploymentCircuitBreaker`; network configuration |
| `ecs describe-task-definition` | The service revision (image, notification env, secret names only), the last 10 revisions of that family (rollback history), and runner-family revisions |
| `ecs list-tasks --service-name tracepoint-staging --desired-status RUNNING`, `ecs describe-tasks` | Running image digests; chunk task exit codes |
| `ecr describe-images --image-ids imageDigest=…` | Tag for each digest, and from it the commit (`<sha>-aws-native-staging`). This identifies the previous app commit and the images in the rollback history |
| `ecs list-task-definitions --family-prefix …` | Revision history of the service family, and the newest runner revisions |
| `rds describe-db-instances --db-instance-identifier tracepoint-staging-full-aws` | Engine version (expected `18.4`) and status |
| `rds describe-db-snapshots --db-instance-identifier tracepoint-staging-full-aws` | The latest 10 snapshots |
| `scheduler list-schedules`, `events list-rules`, `events list-targets-by-rule`, `events list-api-destinations`, `sesv2 get-account` | Notification delivery state (§0.4) |
| `ecs run-task` (14×), `ecs wait tasks-stopped` | The kit chunks (§0.5) |
| `logs filter-log-events --log-group-name <runner awslogs-group> --log-stream-names <prefix>/<container>/<task id>` | Chunk output. This is the same call `collect-staging-release-evidence.mjs` uses. `apply-app-migrations.ps1` itself never fetches logs: it only checks the exit code |

Only with `-RunMigrateDbStatus`:
- `ecr describe-images --image-ids imageTag=<HEAD>` and `imageTag=migration-<HEAD>-aws-native-staging` (pre-check);
- then `scripts/migrate-db.ps1 staging -Action status` unchanged;
- then `describe-tasks`, `describe-task-definition` and `filter-log-events` for its task.

There are no IAM, CloudFormation, CDK, ECR push, CodeBuild, S3, `update-service`, task-definition registration or migration calls.

### 0.4 Notification delivery (TRN-08)

Queued email goes out only when something POSTs `/api/notifications/email-dispatch`. `infra/lib` defines no schedule for it. The only schedules there are the backup rules in `backup-recovery-stack.ts`.

The script records:
- every EventBridge Scheduler schedule;
- every EventBridge rule, with its targets;
- every API destination;
- the SES account state (`SendingEnabled`, production access);
- the service task definition's `TRACEPOINT_NOTIFICATION_MODE` and `TRACEPOINT_EMAIL_PROVIDER`, and whether `NOTIFICATION_DISPATCH_SECRET` is injected (the name only).

"Disabled" means no schedule, rule or API destination whose name, target or endpoint matches dispatch, notification or email. A rule that targets an API destination also counts as a match. Any match is a FAIL. An access-denied response on any of these reads is UNVERIFIED, and UNVERIFIED is a NO-GO until someone checks it by hand. The kit's G4g records the `Pending` queue rows.

### 0.5 How the kit runs (G2 ledger, G3, G4, A) without a new task definition

- **No new task definition and no image build.** The script reuses the newest **already registered** revision of `tracepoint-staging-database-bootstrap` that has the migration-runner shape. `apply-app-migrations.ps1` registers such a revision on every migration run. The required shape:
  - one Fargate container;
  - exactly one secret, `TRACEPOINT_DATABASE_SECRET_JSON` from `tracepoint/staging/database/migrator`, the same injected secret as the migration runner;
  - `CONFIGURATION_ENVIRONMENT=staging` and `TRACEPOINT_DATABASE_CA_PATH=/app/rds-ca.pem`;
  - a digest-pinned `tracepoint-staging` image;
  - an `awslogs` configuration;
  - entry point `node`.
  If no such revision exists, the script **stops**. It does not register one. The only existing way to get one is a run of `migrate-db.ps1` or `apply-app-migrations.ps1`, and both register a revision (owner decision).
- **Network configuration:** the `tracepoint-staging` service's `awsvpcConfiguration`, as `Invoke-MigrationTask` uses.
- **Command override:** `node -e "eval(gunzip(TP_PF_JS))"`.
  - The runner (3,431 bytes, gzip+base64 2,220) uses the `pg` client and RDS CA already in the image.
  - It verifies the chunk's sha256 (`TP_PF_SHA`).
  - It parses the chunk and refuses anything other than `SELECT`/`WITH` before it connects. The kit's own `begin transaction read only;` and `rollback;` lines are skipped.
  - It connects with TLS (`rejectUnauthorized`) and `options: -c default_transaction_read_only=on`, and fails unless `show default_transaction_read_only` is `on`.
  - It runs the whole chunk inside one `begin transaction read only … rollback`, and fails hard unless `show transaction_read_only` is `on` both at the start and at the end.
  - Each statement runs under a savepoint, so one error is recorded without hiding the rest. This matches the psql behaviour without `ON_ERROR_STOP`.
  - It prints JSON records (`TPPF <chunk> <n> <part>/<parts>`, split at 4,000 characters, below the awslogs 16 KB line split) to the task log.
- **Canary:** the `SESSION` chunk runs first, alone. The script continues only if it shows `tracepoint_migrator` with read-only `on`. The other chunks then run in parallel.
- **Delivery and size:** each chunk is gzip+base64 in the environment variable `TP_PF_SQL`. The whole `--overrides` JSON is limited to 8,192 characters by ECS; the script holds itself to a 7,680-byte budget. A chunk over budget is split again at the `\echo '-- X` line nearest its middle.
  - The script checks that the chunks reassemble byte for byte to the committed kit, that each chunk is a slice of it, and that each gzip round trip matches the chunk sha256.

**Chunk sizes, measured locally on the committed kit** (node zlib default level; .NET `Optimal` is within a few bytes, and the script re-measures and re-splits at run time):

| Chunk | Kit lines | Raw bytes | gzip+base64 | Overrides JSON bytes |
|---|---|---|---|---|
| SESSION | 1–20 | 1,053 | 848 | 3,425 |
| G2-1 (G2.1 ledger, G2.2) | 21–94 | 7,453 | 4,848 | 7,422 |
| G2-2 (G2.3) | 95–160 | 6,948 | 4,536 | 7,110 |
| G3-1 (G3.1–G3.4) | 161–301 | 11,025 | 3,392 | 5,966 |
| G3-2-1 (G3.5–G3.8) | 302–370 | 6,319 | 2,660 | 5,236 |
| G3-2-2 (G3.9) | 371–443 | 6,539 | 3,200 | 5,776 |
| G4a | 444–494 | 3,227 | 1,040 | 3,613 |
| G4b | 495–507 | 806 | 556 | 3,129 |
| G4c | 508–598 | 5,450 | 2,216 | 4,789 |
| G4d | 599–615 | 1,646 | 780 | 3,353 |
| G4e | 616–627 | 944 | 684 | 3,257 |
| G4f | 628–658 | 2,808 | 1,560 | 4,133 |
| G4g | 659–672 | 907 | 668 | 3,241 |
| A (after checks) | 673–719 | 4,647 | 2,180 | 4,751 |

Unsplit, G2 needs 7,816 bytes, which is too close to the limit, and G3 needs 10,764 bytes, which is over it. Both are split automatically as shown.

### 0.6 G2 and `migrate-db.ps1 staging -Action status`

**The database side is read-only.** The `status` action of `run-aws-native-migrations.mjs` runs only `to_regclass` and a `SELECT` on the ledger. It takes no lock and runs no DDL.

**The AWS side is not read-only.**
- `apply-app-migrations.ps1` registers a new `tracepoint-staging-database-bootstrap` revision on every run, including `status`.
- If the tag `migration-<HEAD>-aws-native-staging` is missing, it also uploads a source archive, starts a CodeBuild build and pushes an image.
- `migrate-db.ps1` first requires the ECR tag `imageTag=<HEAD>` (a bare SHA). The current staging buildspec accepts only `^(migration-)?<sha>-aws-native-staging$`, and `deploy-app.ps1` publishes `<sha>-aws-native-staging`. So unless an older bare-SHA tag exists for HEAD, `migrate-db.ps1 staging` stops at that check.

**What the script does instead:**
- It answers G2 from the kit's `G2.1` ledger read, compared with the sha256 values it computes from `-ReleaseCommit`.
- Before apply, GO requires all of:
  - ledger rows exactly 001–037;
  - every ledger row matches the release file by version, filename and sha256;
  - pending exactly 038–046 and 048–053 (15 files).
- After apply, GO requires all 52 files applied and none pending.
- `-RunMigrateDbStatus` runs `migrate-db.ps1` unchanged, but only when both image tags already exist, so that the only AWS write is the revision registration. It then captures the status JSON from that task's log into `g2-migrate-db-status.json`. Run it from a checkout of the release commit: the runner image compares the ledger with HEAD's `database/aws`.

### 0.7 Not verifiable offline, and what could stop the run

- **No PowerShell was available where this was written.** The script was checked in three ways:
  - parsed with the tree-sitter PowerShell grammar (`tree-sitter-powershell` 0.26.4): 0 errors (the grammar also flags valid lines in `migrate-db.ps1`; those constructs are avoided here);
  - the embedded runner, chunking, size calculation and gzip delivery were reproduced in node from the script text and run against a disposable PostgreSQL 16 (§5 build), at 037 and after 038–053 of `70717ba`. All 14 chunks ran: 52 statements, 0 errors, `tracepoint_migrator`, read-only `on`/`on`, every chunk sha256 verified.
  - Negative tests: an `INSERT` chunk and a `SET` chunk are refused before connecting; a data-modifying CTE fails with 25006 and the ledger is unchanged; a wrong sha256 is fatal.
  - Run `-SelfTest` once on the workstation before step 3.
- **The SSO role's permissions are not in the repository** (the permission set is managed outside it). The procedure needs these, which existing scripts already use with this role: `ecs:RunTask` and `iam:PassRole` for the runner's roles (`apply-app-migrations.ps1`), and `logs:FilterLogEvents` (`collect-staging-release-evidence.mjs`). If `scheduler:ListSchedules`, `events:List*` or `ses:GetAccount` are denied, the notification check reads UNVERIFIED.
- **The runner revision copies `user: node` and `entryPoint: ["node"]` from bootstrap revision `:27`** onto the distroless migration image. That works if earlier migration runs succeeded. If the canary task fails to start, the summary shows the stop code. That is a NO-GO, and fixing it needs a new revision, which is an owner decision.
- `run-task` starts 14 Fargate tasks. Each one creates an ENI, a log stream and a short database session with application name `tracepoint-readonly-preflight`. Nothing else is created.

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

- G2: see §0.6. `migrate-db.ps1 staging -Action status` reads the ledger read-only, but it is not read-only on AWS. §0 answers G2 from the kit's ledger read instead.
- Running this kit (G3, G4, the after checks) has no psql path. §0 runs it through the existing migration-runner task definition with a `node -e` command override instead (§0.5). That needs no new task definition and no new image. The manual psql route in §2 remains valid if a connection ever exists.
- Whatever path is chosen, connect as **`tracepoint_migrator`**. Two reasons:
  - G3.5 compares object owners with that role.
  - The counts in G4 must not be filtered by RLS. The owner bypasses RLS; the rehearsal found no table with `FORCE ROW LEVEL SECURITY`.

  The runtime role would return RLS-filtered counts. The SSO role only authorizes the AWS side; there is no IAM database authentication.

**Engine version:** `infra/lib/staging-database-stack.ts` pins **PostgreSQL 18.4**, not 17. The rehearsal ran on PostgreSQL 16.15, the newest version available locally. The kit uses only catalog views and functions that are stable from 16 to 18: `pg_policies`, `pg_trigger`, `aclexplode`, `to_regprocedure`, `pg_get_functiondef` and `pg_attribute.attnotnull`.

## 2. Manual psql route (only if a connection exists)

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
   - Run the diff from a checkout of `70717ba`, or of the deploy SHA.
5. Run `migrate-db.ps1 staging -Action apply`, then `-Action status`.
6. Run the kit again and save the output as "after". Compare it with "before".

## 3. What each output must show for GO

The script's `summary.txt` turns these into PASS/FAIL where the criterion is mechanical: chunk completion, G2, G3.1–G3.7, G4f R0, and A.3 after apply. Everything else is RECORDED or REVIEW, for the operator to read against this table.

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
| G3.6 | `grantor_is_owner` = `t` on the `personal_rifle_status_history` and `create_department_with_owner` rows. A grant made by another role survives the REVOKE in 052 or 039, so A.3 or A.5 would then fail. At `70717ba` the `firearm_status_history` rows are context only: 053 keeps them. A 053 that revokes them makes those rows required too; the script decides from `-ReleaseCommit`. | no rows for `personal_rifle_status_history`; `firearm_status_history` INSERT/UPDATE/DELETE for `authenticated` **retained** (037 grants); no `authenticated` EXECUTE on `create_department_with_owner` | `70717ba` local: after = 3 `firearm_status_history` rows only |
| G3.7 | all 13 `t`. If one of the 048–052 rows is `f`, staging names that policy differently and the old permissive policy would survive next to the new one: **stop**. The 053 row is required only for a 053 that drops it. | 048 "member" rows `f`; `attachments_select`, `profiles_select_self_or_department_admin`, `ammunition_reconciliations_update` and the 053 row `firearm_status_history_insert_managers` `t` (kept at `70717ba`) | `70717ba` local: 13 t → 9 f, 4 t |
| G3.8 | SELECT/ALL policies are only the G3.7 names plus `*_manage_training` | the 14 rows in the rehearsal "after" output (`*_select_own_or_authorized`, `range_packets_select_authorized`, `attachments_select`, the profiles policy, `*_manage_training`) | as expected |
| G3.9 | advisory: "matches 037 rehearsal" or "differs (inspect)". A missing column used by 038–053 is NO-GO; an extra column is fine. | "matches 053 rehearsal" for `fleet_vehicles`, `personal_rifles`, `training_certifications` and `fleet_audit_outbox`. The `fleet_audit_outbox` fingerprint includes the 046 column `delivered_by_existing_audit`. | 52 match + outbox absent → 53 match (`70717ba` local: outbox matches) |
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
| A.3 | — | at `70717ba`: `f, t, f, t, 0` (rifle history insert refused; firearm history keeps the 037 INSERT/UPDATE/DELETE). A contract 053 would give `f, f, f, f, 0`. The script checks the variant that `-ReleaseCommit` contains. | `70717ba` local: before t,t,…; after f, t, f, t, 0 |
| A.4 / A.5 / A.6 | — | `t`; `f, t`; all `t` (A.6 now lists 7 columns, including `fleet_audit_outbox.delivered_by_existing_audit`) | `70717ba` local: as expected |

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

Original rehearsal (kit at `8574db3`). Scratch worktree at `8574db3`. PostgreSQL 16.15, non-root, disposable, port 55666.

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

**Re-run for `70717ba` through the §0 runner (2026-10-21, synthetic).**

- PostgreSQL 16 on a disposable server. Schema: Supabase lineage plus `database/aws` 001–037 at `70717ba`, with ledger rows 001–037 carrying the `70717ba` hashes. Superuser login `tracepoint_migrator`; no seed data.
- The script's embedded runner and chunk markers were extracted from the `.ps1` text and run with `node -e` inside a copy of the image's `.next/standalone` tree (`pg` 8.23.0). A local-only preload turned TLS off.
- At 037: all 14 chunks ran, 52 statements, 0 errors; G2.3 = 37/37/0/15/0.
- Then 038–053 of `70717ba` applied cleanly. After: 0 errors; G2.3 = 52/52/0/0/0, latest 53; G3.7 = 9 f, 4 t; G3.9 `fleet_audit_outbox` "matches 053 rehearsal"; A.3 = f, t, f, t, 0; A.5 = f, t; A.6 all t.
- The kit's embedded sha256 values (104 rows) equal `git show 70717ba:database/aws/<file> | sha256sum`.

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
