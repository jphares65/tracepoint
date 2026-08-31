# Supabase Storage to S3 migration runbook

## Mapping

Create the deferred bucket only when the server-only `ObjectStore` contract and
tests are merged. Use opaque keys such as
`agencies/{department_uuid}/{domain}/{record_uuid}/{object_uuid}`; never trust a
client-supplied prefix. Preserve original filename/content type in protected
metadata, not as an authorization-bearing key. Map `tracepoint-attachments` and
`department-assets` separately by lifecycle/policy.

## Controls

Private S3, Block Public Access, BucketOwnerEnforced, TLS-only bucket policy,
SSE-KMS bucket key, versioning, narrowly scoped task role and presigned URLs no
longer than current need. Server verifies department membership/permission before
signing; constrain method/key/content length/type and never log URLs. Record
actor, department, object ID, hash, size and action in the application audit log.

The current Supabase adapter validates downloaded attachment metadata before
service-role signing: exactly four relative segments, authenticated department
prefix, one of `qualification`, `agency-training`, or `firearm`, and no raw or
encoded traversal/backslash/absolute/unexpected path. Invalid metadata returns
the existing not-found response; valid links remain 60 seconds.

Uploads enter `quarantine/`, trigger asynchronous malware scanning, and move/tag
clean objects to active state; downloads deny pending/infected/failed scans.
Define maximum size and allowed types per domain. Lifecycle incomplete uploads,
quarantined failures and noncurrent versions according to records-retention/legal
policy—do not guess law-enforcement retention periods.

## Migration

Inventory metadata and objects without content first; copy approved staging data
with checksum; verify one-to-one metadata, size/hash and tenant key; dual-read
with Supabase fallback only for explicitly unmigrated IDs; then S3 primary.
Writes remain single-provider per cohort to avoid divergence. Reconcile orphans
and missing objects. Rollback switches reads to untouched Supabase objects; never
delete either copy until retention approval.

Deferred policy decisions remain unchanged: physical deletion on archive,
retention, MIME inspection, upload limits, old public patch cleanup, compensation
failure handling, orphan reconciliation and the missing repository definition of
the `tracepoint-attachments` bucket. This safety change does not decide them.
