# Release evidence collection (G1, G2, input for G7)

For release candidate `a628e6c` (`claude/integration-final-20261022`). This tooling lives on the audit branch, so the candidate's SHA is unchanged.

## 1. Collect (read-only)

Run in Windows PowerShell 5.1 on the workstation that has the SSO profiles:

```powershell
aws sso login --profile tracepoint-member-staging
aws sso login --profile tracepoint-production
powershell -NoProfile -ExecutionPolicy Bypass -File .\Collect-ReleaseEvidence.ps1
```

The script calls only `describe`/`list`/`get` APIs and one `s3api get-object` download per environment. It creates, registers, starts and changes nothing, and never reads a secret value or connects to the database. For each environment it records:

| Gate | Evidence | Source |
|---|---|---|
| G2 | Service task definition ARN and revision, deployments, `DEPLOYMENT_VERSION`, `TRACEPOINT_RUNTIME_PROVIDER_MODE`; the running image digest and its ECR tags (`imageResolution`, below) | ECS, ECR |
| G2 | The CodeBuild build that produced the deployed image tag: `SOURCE_COMMIT`, the S3 object version, build status | CodeBuild |
| G2 / G7 | The exact source archive that build used (`deployed-source-<sha>.zip`), with its SHA-256 and a SHA-256 for every `database/aws` file inside it | Versioned S3 build-source bucket |
| G1 | The ledger: every report the migration runner wrote (`applied[]` with version, filename, `content_sha256`, `applied_at`, `application_git_sha`, `is_baseline`; `pending[]`; `latestAppliedVersion`) | CloudWatch Logs of the service and migration task families |

**Image digest (`imageResolution`).** The digest the running tasks of the current revision report is authoritative. The task definition may pin a digest (`repo@sha256:…`) or name a tag (`repo:<sha>-aws-native-<env>`), and a tag can be moved after the tasks started. The script uses the running digest when exactly one is reported, then a pinned digest, then (only if no task reports one) the tag's current digest. `consistent: false` with `problems` means one of these: the running tasks disagree with each other, a pinned digest differs from the running one, the tag has moved, or another revision is still running. Resolve these before G2 passes.

**Ledger status (`ledgerEvidenceStatus: HISTORICAL`).** The CloudWatch reports are the ledger as of the last runner execution. They plan the reconciliation; they are not the current database state. The current ledger is verified by the approved pre-deployment procedure (section 3, step 5), and the runner refuses with `MIGRATION_DRIFT` if it differs.

`workstationGitCoreAutocrlf` is recorded because the deploy scripts use `git archive` on this workstation. With `core.autocrlf=true` the archived `.sql` files have CRLF line endings, and the ledger hashes are of those bytes. The per-file hashes from the zip are what the ledger is compared with.

**Production log search.** Production migration tasks reuse the service task family, so the search covers the application log group, which can take several minutes. Narrow it with `-LedgerSince 2026-09-01` if needed. If no runner report is found, the summary says so (`ledgerNote`). The ledger then has to be read at deployment time (section 3), and the plan stops there if it differs.

## 2. Share

1. Send `release-evidence-summary.json`. It contains account IDs, ARNs, digests, commit SHAs and migration hashes, but no credentials and no environment variable values. Pasting it into the session is fine.
2. **Review each archive for sensitive files before it leaves the workstation.** `sensitiveFileReview` lists, for each archive, the paths (and line numbers) that match name or content rules: dotenv, key and keystore files, credentials files, AWS access keys, private-key blocks, tokens, connection strings with passwords, and quoted secret-like assignments. Matched values are never written out. Open every listed file.
   - Test fixtures, placeholders and public values can be published.
   - **Anything real** (a key, a password, a token, a production URL with credentials) must be removed from the copy you publish and **rotated**, because it has already been in the build-source bucket.
   - A clean result is not proof that there are no secrets. Skim `src/` and `scripts/` for configuration files as well.
3. Make the two `deployed-source-*.zip` archives available, after step 2. Pick one:
   - **(a) If the deployed commits exist in your local clone** (`deployedCommitAvailableLocally: true`), push them to their own branches. This preserves the real history; review that commit's tree the same way:
     ```powershell
     git push origin <staging-sha>:refs/heads/deployed/staging-<short>
     git push origin <production-sha>:refs/heads/deployed/production-<short>
     ```
   - **(b) Otherwise**, publish the reviewed archive contents as a snapshot branch:
     ```powershell
     $zip = '<path>\deployed-source-<sha>.zip'; $dir = "$env:TEMP\deployed-<short>"
     Expand-Archive $zip $dir   # remove anything step 2 found before continuing
     git -C $dir init; git -C $dir checkout -b deployed/staging-<short>
     git -C $dir add -A; git -C $dir commit -m "Snapshot of the source archive that built <sha> (S3 version <id>)"
     git -C $dir push https://github.com/jphares65/tracepoint.git HEAD
     ```

   Either option publishes deployed source to the private repository. That is your decision; the collection step does not do it.

Keep `*.local-only.json` on the workstation; the full task definitions include environment variable values.

## 3. What happens next (in the session)

1. **G2:** check that the running digest (`imageResolution.consistent`), the image tag's commit, the build's `SOURCE_COMMIT` and the source archive all agree, for both environments.
2. **G1:** compare each recorded ledger row with the archive's `database/aws` file of the same version (filename and SHA-256 must match exactly), and staging with production. Then decide on 055/056 using the rules in `docs/remediation/FINAL-CANDIDATE-20261022.md` §3:
   - keep them if nothing after 053 is recorded;
   - otherwise add the applied files byte for byte and move 055 and 056 to the next free numbers.
3. **G7:** run the deployed source's own test suite and bootstrap against the candidate schema. This covers a clean database, and also the staging prefix (the applied files exactly, then only the pending ones).
4. Any change from steps 2–3 is a new candidate commit with full CI.
5. Then the staging plan (§6 of that document). Its first step re-reads the ledger with the runner. That is not read-only on the AWS side: `migrate-db.ps1 status` registers a task-definition revision, runs a Fargate task, and builds a migration image if none exists for the commit. The runner refuses (`MIGRATION_DRIFT`) if the ledger has changed since this evidence was collected.
