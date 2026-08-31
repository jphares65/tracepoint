# Supabase Storage contract inventory

**Source review:** 2026-08-30
**Runtime provider:** Supabase Storage only
**Buckets:** private-use `tracepoint-attachments`; public `department-assets`

This inventory is source-backed. It did not query Supabase, read objects or
records, or call AWS. Where repository evidence is absent, the gap is stated.
All active storage operations are server routes using the service-role client
returned as `context.admin`; that client bypasses Storage RLS. Browser components
send multipart files or attachment IDs to those routes and never call Supabase
Storage directly.

## Flow matrix

| Flow | Access and permission | Object and validation | Metadata, audit, and failure behavior |
|---|---|---|---|
| Qualification evidence `GET/POST /api/qualifications/[resultId]/evidence` | `resolveServerAccess`; feature `qualifications`; POST requires `manage_qualifications` or `manage_range_days`. The result is verified inside the selected department's `pilot_range_workspaces.workspace`; absent is 404, query error 500. GET has no additional permission beyond authenticated department access and the feature. | `tracepoint-attachments`; `{departmentId}/qualification/{encodeURIComponent(resultId)}/{uuid}-{sanitized original name}`. JPG/PNG/WebP only, 15 MB maximum, zero-byte files are not explicitly rejected, `upsert:false`. Client controls result ID URL segment, filename, MIME declaration, bytes, and a 300-character description; department and prefix are server-derived. | Inserts `attachments` with `entity_type=qualification`, text `entity_key`, `q_target`, original filename/MIME/size/path/uploader. Metadata failure returns its message as 500 and attempts object removal, but cleanup failure is ignored. Successful insert attempts `qualification_evidence_uploaded`; audit failure is ignored. Success is 201. Upload errors are 500. Multi-file browser upload is sequential and stops at the first error, so earlier files remain committed. |
| Agency training file `GET/POST /api/agency-training/events/[eventId]/files` | `resolveServerAccess`; event lookup is department-scoped. POST requires one of `manage_training`, `manage_certifications`, `manage_range_days`; completed events return 409. There is no feature gate in this route. GET requires only authenticated selected-department access. Lookup error is 500 and absent event is 404. | `tracepoint-attachments`; `{departmentId}/agency-training/{eventId}/{uuid}-{sanitized original name}`. Any MIME/type is accepted, including an empty browser MIME which becomes `application/octet-stream`; 25 MB maximum; zero-byte files are not explicitly rejected; `upsert:false`. Client controls event ID, filename, declared MIME, bytes, `kind`, and an unbounded description. Only exact `lesson_plan` maps to `training_lesson_plan`; everything else maps to supporting document. | Inserts `attachments` linked by `entity_id=eventId`, with original name/MIME/size/path/uploader. Metadata failure returns 500 and attempts removal; cleanup failure is ignored. No explicit application audit insert exists in this route, and repository evidence does not prove a DB trigger covers it. Success is 201; upload failures are 500. |
| Firearm attachment `GET/POST /api/armory/firearms/[firearmId]/attachments` | `resolveServerAccess`; firearm lookup is department-scoped. POST requires feature `firearms` and `manage_firearms`; GET does not apply the feature or permission check. Lookup error is 500 and absent firearm is 404. | `tracepoint-attachments`; `{departmentId}/firearm/{firearmId}/{uuid}-{sanitized original name}`. PDF/JPG/PNG/WebP only, 15 MB maximum, zero-byte files are not explicitly rejected, `upsert:false`. Client controls firearm ID, filename, MIME declaration, bytes, category and a description truncated to 500 characters. Category is allow-listed. | Inserts department-scoped `attachments` metadata. Metadata failure returns 500 and attempts removal; cleanup failure is ignored. Successful insert attempts `attachment_uploaded`; audit failure is ignored. Success is 201; upload failures are 500. |
| Shared attachment download `GET /api/attachments/[attachmentId]/download` | `resolveServerAccess`; metadata query requires matching `attachmentId`, selected `department_id`, and `archived_at is null`. There is no entity-specific feature or permission check. Query error is 500, absent/foreign/archived metadata is 404. | Reads the stored path from DB, validates exactly four relative segments rooted at the authorized department and an expected attachment domain, then signs in `tracepoint-attachments` for exactly 60 seconds with the stored original filename. Cross-department, missing-prefix, absolute, traversal/encoded-traversal, backslash, unexpected-domain and extra-segment paths fail closed as 404. | Signing failure or missing URL is 500. Success remains a Next.js redirect to the signed Supabase URL. No download audit is recorded. Synthetic path tests cover valid and negative cases. |
| Attachment archive `DELETE /api/attachments/[attachmentId]` | `resolveServerAccess`; requires any of `manage_firearms`, `manage_qualifications`, `manage_inspections`, `manage_range_days`. Metadata selection and update are department-scoped and active-only. Query/update errors are 500; absent is 404. | No object operation occurs. The browser controls attachment ID and a reason truncated to 500 characters. | Sets archive timestamp/user/reason and attempts `attachment_archived`; audit failure is ignored. Object bytes remain indefinitely. Thus archive is not delete, and no cleanup/reconciliation process is evidenced. Success is 200 `{ok:true}`. The permission is not narrowed to the attachment's entity type, so any listed permission can archive any department attachment. |
| Department patch `POST /api/settings/department-patch` | `resolveServerAccess`; requires `administer_department`. Authentication/access errors retain resolver status; denial is 403. | Public `department-assets`; `{departmentId}/patch-{Date.now()}.{png|jpg|webp}`. PNG/JPG/WebP only. Server route accepts `>0` through 5 MB and uses `upsert:true`; browser UI rejects over 2 MB. The committed bucket migration sets a 2 MB limit, so 2–5 MB files pass the route but should be rejected by that configured bucket. Client controls filename (unused), MIME declaration and bytes; department/path/extension are server-derived. | Gets a public URL and writes it to `departments.patch_url`. Upload or DB update failure is 500. DB failure attempts object removal and ignores cleanup failure. Success is 200 with `{ok:true,patchUrl}`. No explicit application audit is present; DB-trigger coverage is not proven here. A new timestamped key means `upsert:true` normally does not replace the previous object, and the old patch is never removed after a successful DB update, producing retained/orphaned public assets. |

All routes first inherit `resolveServerAccess` outcomes: 401 unauthenticated, 403
for no membership or invalid Support Mode, 404 for a missing Support Mode agency,
409 when multiple memberships require agency selection, and 500 for access-query
failures. Feature checks return 403 with `FEATURE_NOT_ENABLED`.

## Authorization and input findings

- Department IDs and bucket names are never accepted from these browser requests.
  The selected department comes from validated server access context. Record IDs,
  attachment IDs, original filenames, declared MIME types, descriptions, category,
  and training kind are client-controlled.
- Generated filenames allow only ASCII letters, digits, dot, underscore and dash;
  separators and other characters become dashes and names are limited to the last
  120 characters. This prevents a filename from injecting `/` traversal. Record
  IDs are not normalized in training/firearm keys, but both must first match a
  department-scoped database record; qualification result IDs are URL-encoded.
- Every object operation uses the service-role client. Storage RLS therefore does
  not mitigate a missing route check. Current department-scoped record and metadata
  queries are the primary tenant boundary.
- The repository migration creates and policies `department-assets`, but no
  migration found by this review creates or policies `tracepoint-attachments`.
  Its live public/private setting, MIME/size policy and RLS rules are unknown.
- `department-assets` is explicitly public. Public URLs are durable, and previous
  patch objects remain reachable unless removed outside the evidenced code.
- Upload-to-metadata compensation is best effort. Cleanup errors are discarded,
  so failed DB writes can orphan objects. There is no evidenced orphan scanner,
  malware scan, quarantine, checksum, retention worker, or missing-object repair.
- MIME checks trust the browser-declared `File.type`; file signatures are not
  inspected. Size checks occur after multipart parsing and before conversion to a
  byte array, but request-body limits outside these routes are not evidenced.

The path-signing risk identified in the initial review is implemented and tested.
Intentionally deferred findings are physical deletion/retention on archive, MIME
inspection, upload-size policy, old public patch cleanup, compensation failures,
orphan reconciliation and a repository migration defining
`tracepoint-attachments`; each requires a separate policy/schema decision.

## Boundary implemented from this contract

`src/lib/storage/object-store.ts` is marked server-only. Its contract names only
the five required capabilities and exposes no bucket parameter or generic
`from(bucket)` escape hatch. `SupabaseObjectStore` is the sole implementation,
uses the exact `context.admin` instance supplied by each route, pins both bucket
names internally, preserves key formats/upsert/signing behavior, and rejects any
unsupported `TRACEPOINT_STORAGE_PROVIDER` value at first construction. No AWS or
S3 provider exists.
