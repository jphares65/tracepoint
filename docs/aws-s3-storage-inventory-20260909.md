# AWS S3 storage completion inventory

**Source review:** 2026-09-09

**Scope:** application object storage, migration utilities, and the private S3 foundation
**Excluded lookalikes:** browser `localStorage`, generated exports, database rows that do not reference stored objects, and non-storage Supabase database/auth calls

This inventory is source-backed. It does not query either provider, read customer objects, deploy infrastructure, or change production. The older `aws-storage-contract-inventory.md` remains the pre-S3 baseline; this document records the completed provider-neutral state.

## Provider boundary and selection

- All active application object operations enter through the server-only `createObjectStore` factory in `src/lib/storage/object-store.ts`.
- `aws-native + s3` and the staged migration combination `bridge + s3` select the S3 adapter. `bridge + supabase` is the only combination that can load the legacy adapter. Missing, unknown, and `aws-native + supabase` combinations fail closed.
- The S3 path does not read the supplied legacy client and does not resolve the dynamic `supabase-object-store` import. A focused test supplies a throwing `storage` getter and a throwing Supabase loader to prove neither can run in aws-native mode.
- The factory reuses one AWS SDK v3 `S3Client` per Region. ECS obtains short-lived task-role credentials through the default credential chain. No browser receives AWS credentials or a generic bucket/key API.
- Browser components only call authenticated application routes. No Client Component imports a Supabase storage client or invokes `.storage`.

## Buckets, namespaces, and logical references

| Logical source | Legacy Supabase bucket | Private S3 key | Persisted document reference |
|---|---|---|---|
| Qualification evidence | `tracepoint-attachments` (private) | `attachments/{departmentId}/qualification/{encodedResultId}/{objectId}-{safeName}` | `attachments.storage_path` stores the logical path without `attachments/`; `entity_type=qualification`, `entity_key=resultId` |
| Agency training file | `tracepoint-attachments` (private) | `attachments/{departmentId}/agency-training/{eventId}/{objectId}-{safeName}` | `attachments.storage_path`; `entity_type=agency_training_event`, `entity_id=eventId` |
| Firearm attachment | `tracepoint-attachments` (private) | `attachments/{departmentId}/firearm/{firearmId}/{objectId}-{safeName}` | `attachments.storage_path`; `entity_type=firearm`, `entity_id=firearmId` |
| Drill Library document | `tracepoint-attachments` (private) | `attachments/{departmentId}/drill-document/{encodedTemplateKey}/{objectId}-{safeName}` | `drill_documents.storage_path`; separate original filename, MIME, size, uploader, and template key columns |
| Department patch | `department-assets` (public in legacy only) | `department-assets/{departmentId}/patch-{timestamp}.{png|jpg|webp}` | `departments.patch_url`; S3 stores a stable authenticated application URL, never an expiring S3 URL |

The filename suffix permits only ASCII letters, digits, dot, underscore, and dash and is bounded to 120 characters. The department, domain, record, and generated object ID are server-derived. Metadata paths must have exactly four segments, an allowed domain, the authorized department prefix, and no absolute path, backslash, control character, traversal, malformed encoding, residual nested encoding, or extra segment. Department patch paths require a UUID department and the exact patch filename grammar.

The Supabase bucket definitions retained for rollback are in:

- `supabase/migrations/202609010001_drill_documents_mvp.sql`: private `tracepoint-attachments`, 25 MiB bucket ceiling, PDF/JPEG/PNG/WebP bucket allow-list.
- `supabase/migrations/202606260003_settings_administration.sql`: public legacy `department-assets` and its Storage policies.

## Runtime operation inventory

| Route | Upload and validation | Read / signed access | Deletion and audit behavior |
|---|---|---|---|
| `POST /api/qualifications/[resultId]/evidence` | Department-scoped result verification; qualification-management permission; non-empty through 15 MiB; JPEG/PNG/WebP; provider repeats type/size/key validation; create-if-absent | `GET /api/attachments/[attachmentId]/download` rechecks tenant metadata and entity authorization, then creates a 60-second attachment download | Metadata insert failure compensates with object delete. Upload emits `qualification_evidence_uploaded`. General attachment DELETE archives metadata only; it intentionally does not physically delete bytes. |
| `POST /api/agency-training/events/[eventId]/files` | Department-scoped event; training-management permission; incomplete event; non-empty through 25 MiB; syntactically valid MIME; provider repeats size/MIME/key validation; create-if-absent | Shared attachment download route; 60-second forced-download URL | Metadata insert failure compensates with object delete. User removal archives the metadata row, not the object. No explicit application upload audit is present. |
| `POST /api/armory/firearms/[firearmId]/attachments` | Department-scoped firearm; feature and management permission; non-empty through 15 MiB; PDF/JPEG/PNG/WebP; category allow-list; provider repeats validation; create-if-absent | Shared attachment download route additionally checks uploader, firearm permissions, or active assignment; 60-second forced-download URL | Metadata insert failure compensates with object delete. Upload emits `attachment_uploaded`. User removal archives metadata only. |
| `POST /api/drill-library/[drillTemplateId]/documents` | Department-scoped template; range-management permission; safe template key; non-empty through 15 MiB; PDF/JPEG/PNG/WebP; provider repeats validation; create-if-absent | `/api/drill-documents/[documentId]/view|download` rechecks department metadata, validates the logical path, then creates a 60-second inline/download URL | `DELETE /api/drill-documents/[documentId]` rechecks tenant and permission, physically deletes the object, deletes metadata, and emits `drill_document_deleted`. Upload emits `drill_document_uploaded`. |
| `POST /api/settings/department-patch` | Department-administration permission; non-empty through 5 MiB; PNG/JPEG/WebP with matching extension; provider repeats validation; create-if-absent | S3 persists `/api/settings/department-patch?path=...`. GET rechecks membership, path, and current `departments.patch_url`, then redirects to a 60-second inline URL. Legacy bridge preserves the existing public Supabase URL. | DB update failure compensates with object delete. Replacing a successful old patch does not delete the prior object. No explicit application upload audit is present. |

S3 `PutObject` requests include expected bucket owner, exact content length, SHA-256 checksum, content type, create-if-absent precondition, and non-sensitive department/domain/object metadata. Failures return a sanitized storage error. S3 download and delete operations revalidate the department path before any SDK call. Response filenames remove control characters and unsafe punctuation.

## Direct Supabase Storage calls outside application runtime

Only the rollback adapter and explicitly invoked staging migration utilities call Supabase Storage:

- `src/lib/storage/supabase-object-store.ts`: fixed-bucket upload, removal, 60-second signing, and legacy public patch URL. This module is dynamically imported only for explicit `bridge + supabase`.
- `scripts/reconcile-staging-storage.mjs`: recursively lists the two fixed staging source buckets and downloads bounded, department-validated objects for inventory/checksum/copy. It targets only the fixed staging project/account and requires a staging migration role.
- `scripts/staging-storage-copy-scenario.mjs`: creates, downloads, lists, and removes two synthetic Supabase fixtures to test reconciliation. It rejects production data by construction.
- `scripts/validate-staging-storage-activation.mjs`: lists at most one object in each fixed source bucket and permits automatic staging activation only when both are empty.
- `src/app/settings/page.tsx.bak`: tracked historical backup text containing the former browser-direct department-patch upload and public-URL calls. The `.tsx.bak` file is not a TypeScript/Next.js module, is not imported, and has no runtime path; the active `page.tsx` calls the authenticated server route.

No other active `src` file calls `.storage`, `storage.from`, `upload`, `download`, `createSignedUrl`, `getPublicUrl`, or Storage removal directly. The Supabase SQL files above define rollback buckets and policies but are not application API calls.

## Direct S3 calls outside application runtime

- `scripts/reconcile-staging-storage.mjs` reads destination objects for checksum comparison and creates missing objects with a content length, SHA-256 checksum, create-only precondition, and the bucket's default KMS encryption. It never overwrites or deletes destination data.
- `scripts/test-staging-s3.mjs` inspects Block Public Access, versioning, and KMS defaults; exercises the provider with synthetic department-scoped objects; and deletes only the exact synthetic object versions and delete markers it created.
- `scripts/staging-storage-copy-scenario.mjs` reads and deletes only its synthetic copied object versions while exercising the Supabase-to-S3 rehearsal path.
- `scripts/run-disposable-staging-acceptance.mjs` lists and deletes versions only beneath newly created disposable department prefixes during its bounded cleanup phase.

The last three utilities are explicit staging acceptance/rehearsal commands, not runtime imports. Application runtime itself issues S3 `PutObject`, presigned `GetObject`, and `DeleteObject` only through `S3ObjectStore`.

## S3 infrastructure controls

`PrivateStorageStack` creates one application bucket and one access-log bucket per environment. Both are retained, versioned, ACL-disabled, TLS-only, and Block Public Access enabled. The application bucket uses the existing customer-managed data key with S3 Bucket Keys; the log destination uses SSE-S3 as required for reliable server-access-log delivery. Bucket policy rejects an explicitly requested non-KMS algorithm, an explicitly supplied wrong KMS key, or an explicit `aws:kms` request that omits the approved key ID. Headerless uploads use the bucket's required customer-managed default key.

The ECS task role can only `GetObject`, `PutObject`, and `DeleteObject` beneath `attachments/*` and `department-assets/*`, with `s3:ResourceAccount` pinned. It cannot list the bucket, change bucket configuration, use ACLs, or delete historical versions. KMS permission is limited to `Decrypt` and `GenerateDataKey` through S3 for the exact bucket encryption context. Server access logs provide request audit evidence. The full-AWS runtime template supplies only the expected account, exact bucket, Region, and `s3` provider; no Supabase URL or secret is present.

SSE-KMS adds KMS request charges; S3 Bucket Keys reduce that request traffic. S3 storage, requests, retained versions, and access-log objects also incur normal service charges. CloudTrail S3 data events and one-minute CloudWatch request metrics would provide richer object-level telemetry but have additional charges and are not enabled by this lane because no paid-resource provisioning was authorized.

## Remaining operational and policy gaps

- Production object inventory, customer-data copy, checksum reconciliation, authority switch, and rollback rehearsal require separate owner authorization. This lane performs none of them.
- Metadata archive for qualification, training, and firearm attachments still retains object bytes. A physical-retention schedule cannot be selected without records-retention and legal approval.
- Replacing a department patch can leave the previous object retained. Cleanup needs a reviewed retention rule and compensation/reconciliation workflow.
- Declared MIME and size are validated at the server and provider boundary, but file signatures, malware quarantine/scanning, and content disarm are not implemented.
- Application audit rows are explicit for qualification, firearm, and drill flows, but not for agency-training uploads or department-patch replacement. S3 server access logs cover provider requests; CloudTrail data events remain an optional paid control.
- Best-effort upload compensation can still leave an orphan if both the metadata write and cleanup delete fail. The bounded staging reconciliation tool detects copy divergence but is not a production orphan worker.
