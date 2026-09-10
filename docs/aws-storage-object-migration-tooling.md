# Supabase Storage to private S3 object migration

**Status:** tooling complete; no provider inventory, copy, validation, deletion, deployment, or cutover has been authorized or performed.

This runbook covers the offline-first migration utility in `scripts/storage-migration.mjs`. It is deliberately separate from application runtime and infrastructure. It has no delete command, never overwrites an S3 object, defaults to dry-run, and works on exactly one department per manifest.

## Safety model

Every provider command must agree on all of these values before a client is used:

- `--environment` or the manifest environment equals `TRACEPOINT_MIGRATION_ENVIRONMENT`.
- The project ref in `TRACEPOINT_MIGRATION_SUPABASE_URL` equals the explicit source project ref.
- The destination bucket, Region, and 12-digit expected owner are embedded in the manifest.
- Every S3 request includes `ExpectedBucketOwner`.
- Every source key begins with the manifest department UUID. Every destination listing is restricted to that department's two prefixes.
- A manifest ID is the SHA-256 digest of all canonicalized manifest content, including the inventory timestamp. Editing any field invalidates it.
- `copy` is dry-run unless `--execute` is present. Execution also requires both acknowledgement flags and `TRACEPOINT_STORAGE_MIGRATION_APPROVAL` equal to the exact manifest ID.
- S3 writes use `If-None-Match: *`, the SHA-256 checksum header, content length, content type, and non-sensitive department/source-hash metadata. A race that creates the object is handled by readback; a conflict is never overwritten.
- Objects are bounded to 25 MiB, matching the largest current legacy bucket policy, and inventories are bounded to 1,000,000 objects per department. Change either bound only through reviewed code.
- Checkpoints are local, mode `0600` where the operating system honors it, atomically replaced, and bound to the manifest ID and department. A resumed entry is trusted only after S3 bytes are downloaded and rehashed.
- Error output contains no object bytes, credentials, signed URLs, or provider response bodies. Treat manifests, reports, and checkpoints as sensitive because they contain object keys and tenant identifiers.

Dry-run prevents remote writes; it is not offline. `inventory`, `copy`, and `reconcile` read provider metadata or bytes. The `report` command is the only fully offline command.

## Artifacts and retention

Create a restricted working directory outside source control for each department:

```text
migration/<environment>/<department UUID>/
  manifest.json
  checkpoint.json
  reconciliation.json
  approval.txt
```

Do not commit these artifacts. Encrypt them at rest, limit access to the migration operators, record their SHA-256 digests in the change record, and dispose of them according to the approved migration evidence-retention policy. Never store the Supabase service-role key or AWS credentials in an artifact or shell history.

## Authorization gates

The following require explicit owner/change authorization and are intentionally not part of this branch's verification:

1. Reading any Supabase project, database, storage metadata, or object bytes.
2. Calling AWS identity or S3 APIs, including read-only calls.
3. Writing any S3 object. This incurs S3 request/storage charges and may incur AWS KMS request charges, data-transfer charges, and source-provider egress charges.
4. Creating CloudTrail data-event selectors, CloudWatch request metrics, inventory reports, lifecycle rules, or other paid resources.
5. Changing application provider configuration, deploying, cutting over, rolling back runtime configuration, or deleting either copy.

Before authorization, confirm private S3, Block Public Access, bucket-owner-enforced object ownership, TLS-only access, versioning, default SSE-KMS, least-privilege migration-role access, encrypted server access logging, and alarms. CloudTrail S3 data events and CloudWatch request metrics are recommended for the authorized copy window, but have cost implications and need a separate approval.

## 1. Preflight

Use short-lived credentials and a dedicated migration role. In a clean shell, set the secrets without echoing them:

```powershell
$env:TRACEPOINT_MIGRATION_ENVIRONMENT = '<environment>'
$env:TRACEPOINT_MIGRATION_SUPABASE_URL = 'https://<expected-project-ref>.supabase.co/'
$env:TRACEPOINT_MIGRATION_SUPABASE_SERVICE_ROLE_KEY = '<secret supplied out of band>'
```

Record the approved source project ref, destination bucket, Region, expected AWS account ID, department UUID, change ticket, operator, start/end window, and rollback owner. Verify that the application is still writing only to Supabase for the department being inventoried, or define an approved final delta/freeze process.

Run one department at a time. Do not use a platform-wide prefix or a manifest containing multiple departments.

## 2. Read-only source inventory and manifest

Metadata-only inventory does not download object bodies:

```powershell
npm run storage:migration -- inventory `
  --department '<department UUID>' `
  --environment '<environment>' `
  --source-project-ref '<expected project ref>' `
  --destination-bucket '<exact private bucket>' `
  --destination-region '<region>' `
  --destination-owner '<12-digit account ID>' `
  --output '<restricted path>\manifest.metadata.json'
```

The copy gate requires a checksum-complete manifest. `--checksum` performs read-only downloads from Supabase and records SHA-256 for each object:

```powershell
npm run storage:migration -- inventory <same arguments> --checksum --output '<restricted path>\manifest.json'
```

Review object count, total bytes, allowed source buckets, department prefix on every source/destination key, MIME values, and manifest ID. Compare the storage inventory with an independently exported, department-scoped database reference inventory for `attachments.storage_path`, `drill_documents.storage_path`, and `departments.patch_url`. A referenced key absent from the storage manifest is a **missing source** finding; repeated logical references or repeated object keys are **duplicates**. Resolve these before copy. The utility rejects duplicate object keys returned during manifest construction.

If writes can continue after inventory, repeat the checksum inventory immediately before copy. A changed object fails the copy because its byte length or hash no longer matches the manifest.

## 3. Dry-run copy

Dry-run is the default and makes no S3 writes. It reads and hashes source and destination objects and writes only the local checkpoint for objects already verified at the destination:

```powershell
npm run storage:migration -- copy `
  --manifest '<restricted path>\manifest.json' `
  --checkpoint '<restricted path>\checkpoint.json'
```

Exit code `2` means the dry-run found destination objects still missing or a reconciliation report is not clean. Exit code `1` means a safeguard or integrity check failed. Do not treat either as copy authorization.

## 4. Authorized copy and resume

Only after review and an approved change window, bind the approval to the reviewed manifest:

```powershell
$env:TRACEPOINT_STORAGE_MIGRATION_APPROVAL = '<exact manifestId>'
npm run storage:migration -- copy `
  --manifest '<restricted path>\manifest.json' `
  --checkpoint '<restricted path>\checkpoint.json' `
  --execute `
  --acknowledge-source-read `
  --acknowledge-s3-write
```

Interruption is safe. Re-run the identical command with the identical manifest and checkpoint. Completed objects are downloaded and rehashed before being marked `resumed`; incomplete objects go through normal source verification and create-only copy. Never hand-edit a checkpoint. If it is lost, begin with a new checkpoint: existing matching S3 objects are verified and no new version is written.

On a checksum mismatch, source drift, unexpected owner, or precondition conflict with different bytes, stop. Do not delete, overwrite, or create a new manifest until the discrepancy is investigated and documented.

## 5. Post-copy validation

Run full source/destination checksum reconciliation:

```powershell
npm run storage:migration -- reconcile --manifest '<restricted path>\manifest.json'
```

Capture the JSON output. A cutover candidate must have:

- `clean: true`;
- zero missing source objects;
- zero missing destination objects;
- zero duplicate source or destination keys;
- zero size or SHA-256 mismatches; and
- zero S3 objects outside the manifest beneath either department prefix.

The S3 list and body reads remain department-scoped. Re-run the independent database-reference comparison so every active logical record has exactly one manifest entry and every manifest entry is expected by data policy. Sample each application domain through the authenticated application in a non-production rehearsal before production authorization. Verify forced-download versus inline behavior, content type, original filename, audit logging, authorization failure behavior, and 60-second URL expiry.

## 6. Cross-tenant isolation procedure

Use two synthetic departments in an isolated, disposable environment; never use customer data for this test.

1. Create one synthetic object in every supported domain for department A and department B, using visibly different bytes.
2. Inventory A. Confirm its manifest contains only A source keys and destination prefixes.
3. Attempt to construct a manifest for A with one B key. It must fail before a provider write.
4. Copy A. Confirm no B prefix receives a request or object. Review S3 access logs/CloudTrail data events if separately enabled.
5. Authenticate as an A-only user. A downloads succeed; every B logical path, encoded traversal variant, direct application route, and stale signed URL attempt is denied without revealing existence.
6. Repeat as B and as an unauthorized/platform-support identity. Verify support access follows the separately approved application authorization model.
7. Run A reconciliation while B objects exist. B objects must not be reported as A orphans. Add an extra object under A's prefix and confirm it is reported as an A orphan.
8. Delete only the specifically authorized synthetic fixtures using a separate reviewed cleanup procedure. The migration utility intentionally cannot delete them.

The unit test suite covers steps 2, 3, 4, and 7 with in-memory adapters. Live authorization tests remain a cutover gate.

## 7. Cutover

Cutover is a separate change and is not implemented by this tooling branch.

1. Freeze writes for the department or use the approved bounded delta process.
2. Regenerate the checksum manifest, run copy, and obtain a clean reconciliation report.
3. Record the manifest/report/checkpoint hashes and peer approval.
4. Change only the documented provider configuration for the approved cohort through the normal release lane.
5. Validate authenticated reads/uploads/deletes with synthetic data, tenant isolation, metrics, logs, and alarms.
6. Keep Supabase objects unchanged and accessible to the rollback operator. Do not disable credentials or remove policies needed for rollback during the observation window.
7. End the freeze only after the migration owner, application owner, security reviewer, and department/business owner accept the evidence.

## 8. Rollback and reversal

Rollback changes the application's cohort/provider configuration back to Supabase; it does not reverse-copy or delete S3 data.

Trigger rollback for any authorization bypass, tenant leakage, missing/mismatched bytes, elevated error rate, unacceptable latency, audit gap, or inability to complete synthetic read/write validation. Stop new migration copies, preserve logs and artifacts, switch the affected cohort back through the approved release mechanism, and validate Supabase reads using the unchanged source objects.

Writes made after S3 cutover create a divergence problem. Before cutover, choose and rehearse one policy:

- **Preferred:** a write freeze through the rollback observation decision, so rollback needs no reverse copy.
- **Controlled delta reversal:** inventory only the post-cutover S3 versions created by the application, obtain explicit data-write authorization, copy create-only back to validated Supabase keys, SHA-256 reconcile, then switch. This needs separate tooling/review because the current utility intentionally supports only Supabase-to-S3.

Never bulk-delete S3 objects during rollback. Version IDs, retention obligations, legal holds, application archive semantics, and post-cutover writes must be reviewed first. Decommissioning or deleting either provider's objects is a later records-retention change with separate authorization.

## Verification without provider access

```powershell
npm run storage:migration:test
npx tsc --noEmit
npx eslint scripts/storage-migration-core.mjs scripts/storage-migration.mjs scripts/storage-migration.test.mjs
git diff --check
```

These checks prove deterministic manifest construction, tenant-bound key validation, dry-run behavior, atomic create semantics at the adapter boundary, SHA-256 conflicts, checkpoint resume, category reporting, and explicit approval gates. They do not prove provider permissions, network behavior, production scale, S3/KMS configuration, cost, or customer-data correctness.

## Integration order

1. Merge the completed provider branch.
2. Merge this tooling/documentation branch without changing runtime configuration.
3. Obtain authorization and create a synthetic non-production rehearsal change.
4. Review rehearsal evidence and operating cost, then authorize department-by-department production inventory.
5. Authorize copy, validate, and cut over one cohort at a time with rollback readiness.
6. Consider source decommissioning only after the retention and legal review.
