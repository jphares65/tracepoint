# Remediation batch RT: staging release tooling and release order

Base: `claude/integration-defects-20261020` @ `628b609` (candidate code commit `70717ba`). Branch: `claude/fix-staging-release-order`.

The approved plan applies 038–053 **before** the new image serves traffic (STAGING-VERIFICATION G3). It relies on automatic rollback to the previous image on the migrated schema (`RELEASE-SAFETY-rollback-compatibility.md`). The tooling could not run that sequence. **Nothing here has been executed:** `pwsh` is not available in this environment (§Verification).

## Defects addressed

| ID | Defect | Evidence | Change |
|---|---|---|---|
| RT-1 | `migrate-db.ps1 staging` looks up ECR tag `<sha>`. `deploy-app.ps1` publishes `<sha>-aws-native-staging`, and `buildspec.staging-image.yml` rejects any other tag (`^(migration-)?[0-9a-f]{40}-aws-native-staging$`). The staging check can never pass for a commit after `757551a`. | `c0eb1d4` (2026-09-30 11:59) added `migrate-db.ps1` with the bare tag. Its staging `ImageSuffix` was `''` then, and the buildspec required a bare SHA (`e5efa02`). `757551a` (13:10 the same day) moved deploy-app and the buildspec to the suffix but left `migrate-db.ps1` alone; it has not changed since. Every later commit, including `70717ba`, can only have a suffixed staging image. Production was already suffixed. | Both scripts now call `Get-ApplicationImageTag` in `scripts/deploy-app-rollout-core.ps1`. deploy-app's per-environment `ImageSuffix` is removed (it was used only there). |
| RT-2 | `migrate-db.ps1` used the pre-`168b8d2` scan expression, which deploy-app replaced to "accept clean empty ECR scan results". A clean image would likely be refused even with the right tag. | `git show 168b8d2`: the old expression was replaced in deploy-app only. | `Test-CleanImageScan` moved, unchanged, into the core file. migrate-db uses it. |
| RT-3 | Since `2ef02cf` (2026-10-08), the staging `Dockerfile` runs `scripts/mobile-route-image-contract-core.mjs` and the buildspec runs `scripts/test-staging-image-mobile-routes.sh`. Neither file is in deploy-app's staging source archive or apply-app-migrations' staging archive, so both staging CodeBuild runs fail at those steps. Only `publish-tracepoint-staging-image.ps1` (the GitHub Actions lane) was updated. | `git show 2ef02cf --stat`; `Dockerfile` line 31; buildspec lines 25–27 | Both files added to the two staging archive lists. |
| RT-4 | No publish-without-rollout path in the deploy-app lane. `migrate-db.ps1` requires the image in ECR, while `deploy-app.ps1` published and rolled out in one run. The only order possible was image first, then migrations (`docs/release-runbook.md`), which G3 forbids. | `publish-tracepoint-staging-image.ps1 -Wait` publishes the same tag without rollout. It belongs to the GitHub Actions/CloudFormation lane and refuses any branch except the three `codex/` release branches. It also reads the staging application secret and does not hold deploy-app's lock. It is not the reviewed path for this package. | `deploy-app.ps1 -PublishOnly`: same lock, identity, service-identity, clean-commit and local-validation steps, then `Publish-Image` (build or reuse, clean scan required), then `exit 0` before task registration. Combining it with `-RollbackTaskDefinitionArn` is refused before the lock. |

`migrate-db.ps1 status` footprint (documented, not changed): read-only in the database, but each run registers a new migration task revision and runs a Fargate task. The first run per commit also builds `migration-<sha>-aws-native-staging` (S3 upload and CodeBuild). Details: STAGING-VERIFICATION §2, "Footprint".

## Release sequence (STAGING-VERIFICATION §2–3; RELEASE-SAFETY §4)

From one clean checkout, `HEAD` = deploy SHA, as `TracePointMigrationStaging`:

```powershell
.\scripts\deploy-app.ps1 staging -PublishOnly      # a. ECR only
.\scripts\migrate-db.ps1 staging -Action status    # b. 038–046, 048–053 pending
.\scripts\migrate-db.ps1 staging -Action apply     # c. then -Action status: nothing pending
.\scripts\deploy-app.ps1 staging                   # d. reuses the image; auto-rollback is schema-compatible
# e. acceptance (STAGING-VERIFICATION §4); 054 later, separately approved (§5a)
```

## Verification

`pwsh` is not installed. The npm package `pwsh` is only an installer that downloads PowerShell from GitHub releases, which is outside the permitted npm-registry access. **The PowerShell changes and tests are unexecuted.** They were checked by reading, against the existing mocked-AWS style of `test-deployment-safety.ps1` and `test-rollback-rehearsal.ps1`.

| Test | Kind | Before (original scripts) | After |
|---|---|---|---|
| `scripts/aws-native-staging-image-contract.test.mjs`: three new static cases (shared tag function used by both scripts, no bare staging tag, migrate-db scan helper; mobile-route files in both staging archives; `-PublishOnly` exit after publish and before registration) | node, run | 3 of 6 fail | 6 of 6 pass |
| `scripts/deploy-app-rollout-core.tests.ps1`: tag values, buildspec regex, case-independence, invalid input; `Test-CleanImageScan` cases | PowerShell, **unexecuted** | `Get-ApplicationImageTag` undefined | expected pass |
| `scripts/test-deploy-app-publish-only.ps1` (new): mocked AWS, git and node. `-PublishOnly` exits 0 after the scan check, with no `register-task-definition` or `update-service` call. With a rollback ARN it is refused before any AWS call. A control run without the switch reaches task registration. | PowerShell, **unexecuted** | parameter binding fails (`-PublishOnly` unknown) | expected pass |

The new PowerShell test is not wired into a workflow. `deploy-app-rollout-core.tests.ps1` is not in any workflow either. Run both on Windows PowerShell or `pwsh` before relying on them.

## Rollback

Revert the branch commit. No database, AWS or application-runtime change.
