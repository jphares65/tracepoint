# TracePoint AI Importer V1

The importer is an additive workflow at `/settings/import-export/ai-importer`. Existing onboarding and qualification-history import paths remain unchanged.

## Architecture

- `src/lib/ai-importer/workbook.ts` safely parses CSV, XLSX, and XLS workbooks, applies file/sheet/row/column/cell limits, discovers worksheets, and infers a probable header row.
- `src/lib/ai-importer/provider.ts` defines the inference-provider interface and strict output validator. Provider input contains worksheet names, inferred headers, and at most three representative rows. It never contains a department identifier.
- `src/lib/ai-importer/adapters/` contains independent Personnel, Firearms, Certifications, Vehicles, and Equipment adapters. Each adapter owns canonical fields, aliases, normalization, validation, matching, update previews, and conflict behavior.
- `src/lib/ai-importer/validation.ts` applies reviewed mappings and orchestrates deterministic row validation.
- API route handlers separate interpretation, read-only preview, and approved execution. Preview tokens are HMAC-bound to the file hash, selected sheet/header/domain, mappings, actor, active department, and exact validation result.
- `src/lib/ai-importer/server/execution.ts` revalidates before executing in bounded batches and records approval and completion events in the existing tenant-scoped audit stream.

The browser holds the parsed workbook only for the duration of the wizard. TracePoint does not persist the raw upload. Audit records contain file metadata/hash, approved mappings, domain, counts, failed row numbers, actor, active department, and timestamps—not raw row contents.

## Provider status

V1 ships with `DeterministicInferenceProvider`, so the complete workflow works without external AI credentials. It scores domain candidates from actual headers, proposes alias-based mappings, identifies likely identifiers and date fields, and uses only `High`, `Medium`, and `Needs Review` confidence labels.

A production provider should implement `ImportInferenceProvider.infer`, return exactly the schema enforced by `validateProviderOutput`, and be selected in `configuredProvider`. Provider errors must stay sanitized, and the fallback must remain available. Before enabling a hosted provider, complete vendor security/privacy review for law-enforcement data, configure retention/zero-training controls, and add provider-specific timeout, regional-processing, and contract tests. No provider may add tenant or authorization fields, write data, or bypass deterministic validation.

`TRACEPOINT_IMPORT_APPROVAL_SECRET` may be set to a dedicated high-entropy server secret. When omitted, the server uses the existing Supabase service-role secret for HMAC approval signing. Production startup rejects signing if neither is available.

## Domain behavior

- Personnel uses badge number, employee ID, and email as stable matches. Name-only matching is never used to update a person. Empty cells do not clear existing values.
- Firearms compare normalized serial/asset identifiers, validate active-department assignments, and block assignment conflicts. Missing make/model/caliber are explicitly warned and stored as `TBD / Unknown` only for creates.
- Certifications require an active-department person and an existing configured certification type. Duplicate identity uses credential number, then issue/expiration date.
- Vehicles use normalized VIN/unit identity and support current Fleet vehicle fields plus MDT, modem, MVR, and radar installed-asset serial/warranty fields.
- Equipment requires an existing configured equipment type and serial or asset identity. It validates person/location assignment exclusivity and never creates equipment types implicitly.

Runtime row failures are returned exactly and downloadable as a formula-injection-safe rejected-row CSV. A failure cannot be silent: result counts distinguish created, updated, skipped, failed, and warnings.
