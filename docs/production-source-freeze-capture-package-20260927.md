# Production source fence and frozen-capture package (not activated)

Scope is only Supabase project `izlkwggluhlhzlumtzes`, AWS account `193644343389`, Region `us-east-1`. This package does **not** authorize source freeze by itself. Use it only after the reviewed public maintenance response is externally 503 and the runbook's pre-freeze authority record passes. Do not run the SQL in the paid rehearsal or staging SQL Editor.

## Pinned identities and current read-only evidence

| Item | Exact value |
| --- | --- |
| Production source project | `izlkwggluhlhzlumtzes` |
| Read-only source PG endpoint | `aws-1-us-east-1.pooler.supabase.com:5432/postgres` |
| Read-only PG secret | `arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/migration/source-postgres-KOMJRk` |
| Production REST service secret | `arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/migration/source-supabase-rest-wvh4pi` |
| Source REST origin | `https://izlkwggluhlhzlumtzes.supabase.co` |
| Final artifact | `s3://tracepoint-production-private-193644343389/migration/source/0762cf3d-5f8e-4e89-afa0-051a39e4dce7/final-canonical.json` |
| Artifact KMS key | `arn:aws:kms:us-east-1:193644343389:key/4dc71990-3cfa-49d7-88c6-383bc1067f55` |
| Production relation contract | 122 base relations (87 public, 27 auth, 8 storage); SQL MD5 `36558b0730e3e96cad6426f38088a5b0` |
| Protected write operations | INSERT, UPDATE, DELETE, TRUNCATE; 244 ALWAYS triggers expected |
| Dispatcher | exactly one active `tracepoint-notification-email-dispatch`, expected `*/15 * * * *`, legacy endpoint `tracepoint-amber.vercel.app`; its command hash/job ID are recorded transactionally without outputting the command |

Read-only 2026-09-27 probe used `BEGIN READ ONLY`, client TLS with the bundled Supabase Root 2021 CA fingerprint `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`, verified the endpoint/secret username suffix and account, saw zero existing fence triggers and no cutover schema, and read no customer rows. `pg_stat_ssl` on the pooled backend reports false because the client TLS terminates at Supavisor; the Node TLS socket itself verified the CA and hostname. Production REST secret independently returned HTTP 200 on a zero-row read.

## Preparation before maintenance (no source mutation)

1. Require a clean reviewed commit. Build a tracked-file-only ZIP from that commit, calculate its SHA-256, upload create-only to the private build-source bucket under `source/tracepoint-production-final-capture-<sha256>.zip` with the existing build-source KMS key `6880c1ac-f131-4077-9075-8d063ec43cba`, and record its S3 VersionId. Reject any existing key with different bytes. Do not package `.env`, dirty/untracked files, or local credentials.
2. Validate `infra/changesets/production-source-capture-20260927/template.yml` with `aws cloudformation validate-template` and a create change set. Review the change set: only the dedicated CodeBuild job, its exact-purpose role, encrypted log group/key are permitted. Execute it **during preparation**, not after opening maintenance. `SourceZipKey` is the content-addressed key from step 1. The existing shared permissions boundary is attached unchanged. The new role can read only the production REST secret, the exact source ZIP and KMS key, and write/read only the one final-artifact key. The paid-rehearsal capture role/project remain unchanged. Verify effective IAM and an unexecuted project configuration; never start the capture job before the source fence.
3. Record the reviewed commit, ZIP SHA-256/VersionId, stack ID, CodeBuild project name, role/boundary, artifact bucket encryption/versioning/public-access-block, and production REST secret VersionId. The CodeBuild secret is referenced by JSON field; its value is never copied into a plaintext environment override or log.
4. Rerun the read-only catalog probe. From PowerShell in the reviewed checkout, pipe the exact AWS secret directly to Node stdin (not a disk file):

   ```powershell
   $env:TRACEPOINT_SECRET_STDIN='1'
   aws secretsmanager get-secret-value --secret-id arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/migration/source-postgres-KOMJRk --profile tracepoint-production --region us-east-1 --query SecretString --output text | node scripts/inspect-production-source-catalog.mjs
   ```

   Require exact project/account/endpoint/role, authorized TLS, read-only transaction, 122 relations and the pinned digest, zero existing fence triggers/schema. Any drift stops before freeze. Do not redirect the secret or this pipeline to a file.

## Maintenance-window activation (do not execute during preparation)

1. Verify the external public maintenance response and single-writer gate. Reverify the operator is in the **production** Supabase SQL Editor at a dashboard URL beginning `https://supabase.com/dashboard/project/izlkwggluhlhzlumtzes/`; staging `wztqqqashilusoppddxi` and paid rehearsal `reukdouvpshshvqnzsgw` are forbidden. Require the read-only catalog fingerprint above. The migration-reader credential cannot install triggers; use only the existing authenticated production SQL Editor owner path. The SQL's database/owner/catalog, job-name/schedule/command-shape, in-flight, preexisting-fence, and trigger-count assertions fail closed. Its first DDL and the cron pause are in one transaction, so a failed statement rolls back the entire activation.
2. Run **exactly** `supabase/production-cutover/20260927_activate_source_fence.sql` in that exact production SQL Editor. This transaction records the dispatcher's job ID/schedule/command hash, pauses only that job, installs 122 DML plus 122 TRUNCATE `ENABLE ALWAYS` statement triggers in `public/auth/storage`, and commits `frozen=true` only after all checks pass. Do not manually edit SQL or change the relation count to make it pass.
3. Immediately verify the production-only read RPC returns `frozen=true`, `database=postgres`, `relation_count=122`, `trigger_count=244`, and a valid `changed_at`. Verify dispatcher inactive and zero running invocations. Then run the approved rollback-only/synthetic writer-family negatives; require no persisted writes. If any writer bypasses the fence, **abort before capture** using the reverse gate below while the bridge remains authoritative. The source remains readable for capture.

## Exact frozen capture

Only after the fence and writer negatives pass, run:

```powershell
aws codebuild start-build --project-name tracepoint-production-final-source-capture-20260927 --profile tracepoint-production --region us-east-1 --query 'build.{id:id,arn:arn}' --output json
```

The project has the exact production source URL, project ref, AWS account, run ID and immutable destination key. The buildspec obtains only the production REST secret's `projectUrl` and `serviceRoleKey` fields from Secrets Manager. The runner permits GET for the reviewed 90 relation paths/Auth/Storage objects and POST only for the fixed **read-only** fence-status and Storage-list endpoints. It requires the same fence timestamp before and after all reads, inventories identities/memberships/objects, canonicalizes the complete artifact, uploads create-only with SSE-KMS, requires an S3 VersionId, and reads back by VersionId to verify whole-file SHA-256. Capture logs contain counts/hashes, never rows, keys, passwords or tokens. Record the CodeBuild ID, artifact key/VersionId, master and whole-file hashes. A capture failure leaves the source fenced for an explicit abort decision; do not reuse or overwrite a completed artifact.

## Deterministic pre-authority abort/reversal

This operation is only valid **before** customer traffic or any AWS-only write. First verify the bridge remains authoritative, no AWS-only delta exists, the public maintenance response is still active, and the source fence status/job/trigger contract is exact. In the same exact production SQL Editor, execute **only** `supabase/production-cutover/20260927_abort_source_fence.sql`. It validates the frozen state, 244 trigger set, unchanged relation fingerprint and original dispatcher command hash; transactionally drops only its named triggers/functions/schema and restores that exact dispatcher to its prior active state. Any mismatch rolls back without partially unfreezing. Verify absence of fence objects, dispatcher active, ordinary source write continuity, and bridge health; then reverse only the reviewed public maintenance stack and verify normal external forwarding. Preserve the source/target artifact and logs. **Never use this abort after AWS-only writes**; use the runbook's data-authority rollback instead.

## Boundaries and stop conditions

- No SQL in this package has been executed against production during preparation. No maintenance, source freeze, capture, SES repoint, DNS or authority switch has occurred.
- Production owner SQL Editor access must be explicitly reverified immediately before activation; the AWS migration-reader credential is intentionally insufficient for DDL or cron management.
- Catalog drift, unexpected scheduler state, failed trigger installation, writer bypass, changed fence timestamp, missing artifact VersionId, S3 hash mismatch, or project/secret mismatch is a stop/abort gate, not a reason to relax assertions.
- The existing importer is pinned to the earlier initial artifact. Final target apply remains a **separate runbook gate** and must validate this new final artifact's exact VersionId/hash; this package does not run or alter target apply.
