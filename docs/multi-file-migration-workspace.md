# Multi-File Migration Workspace

The beta workspace at `/settings/import-export/migration` is additive to the Classic Import Mapper and single-file AI-Assisted Importer. It stages mixed CSV/XLS/XLSX batches, groups sources into the five existing importer domains, and builds one canonical working dataset per domain through the existing mappings, remediation rules, adapters, validators, approval signing, execution, and audit writer.

## Staging and retention

`ai_migration_workspaces` stores tenant-scoped structured staging, source metadata and SHA-256 hashes, approved shared mappings, remediation rules, merge decisions, validation digest, status, and completed domains. Uploaded workbook bytes are discarded as soon as each request has been parsed and are never stored. Draft staging expires after 14 days. `expire_ai_migration_workspaces()` removes structured source content and marks expired workspaces; it is intentionally callable only by a trusted maintenance/service role. Administrators can also delete a workspace through the tenant-scoped endpoint.

The additive table has RLS for `administer_department` and every server query also scopes both workspace ID and the authenticated active department. Request bodies cannot select a department. Audit events include file hashes/metadata, mappings, merge rules, validation summaries, and remediation value fingerprints, not full rows or raw remediation values.

## Planning

Sources retain independent sheet/header/domain settings. Approved header mappings are shared by normalized source header within a domain. Workspace remediation rules apply exact source-value matches to the same mapped target field across selected sources and always trigger validation.

Stable domain identifiers form cross-file record groups. Exact duplicates, complementary probable matches, and conflicting records remain blocked until an administrator approves an applicable rule: skip exact duplicates, merge nonblank values, newest source, preferred source, or a field-level source. Ambiguous records are never silently merged.

Personnel is planned before Firearms, Equipment, and Certifications. Valid personnel creates are added as temporary planning references so dependent assignments are not falsely reported as unknown. Execution imports Personnel first, reloads active-department references, and revalidates dependent domains before writing them. Vehicles remain independent. Ready domains may execute separately while blocked domains remain staged.

## Bedrock-assisted workspace analysis

The workspace uses the same provider abstraction as the single-file importer. Each source is first classified and mapped through the configured provider with deterministic fallback. To keep large uploads bounded, at most eight sheet-level hosted calls run concurrently; remaining sheets retain deterministic mappings and are still included in deterministic planning. A workspace-level structured inference then proposes file relationships, reusable mappings, normalization/remediation ideas, and merge precedence. That hosted comparison is capped at 25 source summaries, 40 headers per source, 20 sampled columns, and no more than three redacted/truncated representative rows. All sources—including those outside the hosted comparison cap—remain included in deterministic overlap, validation, and execution logic. Model input uses source IDs generated for the workspace, file metadata, sheet names, SHA-256 hashes, upload timestamps, deterministic domain/mapping hints, and headers. It never receives department IDs, user IDs, credentials, approval tokens, raw files, or full datasets.

Hosted suggestions are persisted under the workspace's `inference` object so a resumable workspace can display them, but they are distinct from `sharedMappings`, `remediations`, and `mergeRules`. The UI labels them `Suggested mapping`, `Suggested fix`, or `Suggested resolution`. They do not alter staged sources or become executable rules. Administrators must make an explicit choice through the existing controls, after which the complete deterministic workspace plan is rebuilt.

If Bedrock configuration, credentials, model access, response structure, or schema validation fails, workspace creation and manual planning continue with deterministic classification and hash/header relationship hints. The workspace displays `AI assistance unavailable — deterministic mapping used.` No hosted-provider failure can mark a domain ready, resolve an overlap, write data, or authorize execution.

Provider environment variables, privacy assumptions, local testing, IAM/model guidance, observability, and the production enablement checklist are documented in `docs/ai-importer-v1.md`.

## Limits and approval

Initial limits are 50 files, 3 MB per file, 25 MB aggregate, 200 staged worksheets, 50,000 source rows, and 15 million expanded characters. Provider inference remains optional and sees only the existing minimized header/three-row input. The workspace state and every domain payload/result are included in the workspace digest; the HMAC also binds workspace ID, active department, and actor. Execution rebuilds the complete plan and rejects stale or mismatched approval before the first domain write.
