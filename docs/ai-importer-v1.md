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

## Provider architecture

`DeterministicInferenceProvider` remains the default, offline/manual provider and final validation authority. `BedrockInferenceProvider` is the optional hosted suggestion layer. Server route handlers select it through `src/lib/ai-importer/server/provider-factory.ts`, which is guarded by `server-only`; browser modules never import the Bedrock SDK or provider configuration.

The Bedrock provider uses `BedrockRuntimeClient` and the Converse API with adaptive retry, an explicit timeout, an explicit `maxTokens` cap, temperature zero, and Converse structured output (`outputConfig.textFormat.type = json_schema`). Versioned prompts live in `src/lib/ai-importer/prompts.ts`, and JSON Schemas live in `src/lib/ai-importer/schemas.ts`. The model ID is not embedded in mapping logic, so a supported foundation model, geographic inference profile, application inference profile, or provisioned-model ARN can be selected without a provider rewrite.

Every response is parsed as JSON and then checked by TracePoint's strict runtime validators. TracePoint rejects extra fields, tenant/security fields, unsupported domains, unknown sheets, fabricated target fields, missing or duplicate source mappings, invalid confidence labels, source values not present in the minimized sample, and malformed suggestions. Valid AI output is still only a proposal: deterministic mapping checks, row validation, approval fingerprints, server-side revalidation, and deterministic execution remain unchanged.

### Configuration

The default and local-safe configuration is:

```text
TRACEPOINT_IMPORT_AI_PROVIDER=deterministic
```

Production Bedrock opt-in requires server-side runtime variables:

```text
TRACEPOINT_IMPORT_AI_PROVIDER=bedrock
TRACEPOINT_IMPORT_BEDROCK_REGION=us-east-1
TRACEPOINT_IMPORT_BEDROCK_MODEL_ID=<supported model ID or inference profile ID/ARN>
```

Optional bounds are `TRACEPOINT_IMPORT_BEDROCK_TIMEOUT_MS` (default `20000`, allowed 1000–60000) and `TRACEPOINT_IMPORT_BEDROCK_MAX_TOKENS` (default `4096`, allowed 512–8192). `validateImportAiConfiguration()` validates provider selection, region, model ID, and deterministic fallback availability. Missing or invalid Bedrock configuration does not prevent startup or importing; inference falls back at request time.

Use a Converse and structured-output-capable model with strong extraction/reasoning and acceptable latency/cost. A US geographic Claude Sonnet inference profile is the recommended starting point; for example, verify whether `us.anthropic.claude-sonnet-4-6` is currently available in the deployment account and region before setting it. Model and inference-profile identifiers change, so production enablement must verify them with `aws bedrock list-foundation-models --region us-east-1` and `aws bedrock list-inference-profiles --region us-east-1`. Prefer a geographic profile when law-enforcement data must remain within that geography; do not silently substitute a global profile.

The SDK uses the AWS default credential provider chain. Do not set AWS keys in source code or any `NEXT_PUBLIC_` variable. The runtime role should have least-privilege `bedrock:InvokeModel` access to the selected model/profile. Cross-region inference profiles require both the profile ARN and routed foundation-model ARNs in the IAM resource allowlist.

### Data minimization and privacy

TracePoint never sends raw file bytes or an entire workbook to Bedrock. Model input is limited to worksheet/file metadata, names, hashes where useful for workspace comparison, inferred headers, row/column counts, current deterministic domain/mapping hints, and at most three representative rows per sheet. Cells are truncated to 120 characters. Notes, comments, remarks, narrative, descriptions, secrets/tokens/password fields, person names, email addresses, and phone numbers are redacted when they are not needed for structural interpretation. Department IDs, actor IDs, auth tokens, credentials, database authority, and import approval tokens are never part of inference input.

Application logs do not contain prompts, model text, representative rows, workbook content, or source values. Privacy-safe events contain only task, provider/model identifier, success/failure/fallback status, latency, token counts when returned, and a sanitized error category. Bedrock model invocation logging captures full prompts and responses if enabled at the AWS account level; keep it disabled for this workload unless an approved encrypted, access-restricted retention design is in place.

### Failure behavior and local testing

Credential failures, access denial, throttling, service unavailability, timeout, malformed structured output, and runtime schema rejection all return the deterministic interpretation instead of failing the importer. The UI shows `AI assistance unavailable — deterministic mapping used.` and leaves every manual mapping control available. Errors exposed to users never contain AWS or model response details.

Automated tests mock the Bedrock client and require no AWS account. For local hosted-provider testing, configure the three Bedrock variables and authenticate through the normal AWS profile/SSO/default provider chain. Without those variables or credentials, use deterministic mode; local development remains fully functional.

### Production enablement checklist

- Verify the configured model/profile supports Converse structured JSON output in the selected region.
- Confirm data-residency requirements before choosing geographic versus global cross-region inference.
- Grant the server runtime role only `bedrock:InvokeModel` for the selected profile/model resources.
- Confirm the Anthropic use-case form or any applicable model terms are complete.
- Keep AWS credentials server-side and use the default role/profile credential chain.
- Review Bedrock invocation logging, CloudTrail, KMS, log access, and retention settings for sensitive data.
- Run provider, importer, migration, TypeScript, ESLint, and production-build validation with mocked inference.
- Perform a separately authorized live smoke test with a synthetic, non-sensitive workbook before switching the production variable from `deterministic` to `bedrock`.

`TRACEPOINT_IMPORT_APPROVAL_SECRET` may be set to a dedicated high-entropy server secret. When omitted, the server uses the existing Supabase service-role secret for HMAC approval signing. Production startup rejects signing if neither is available.

## Domain behavior

- Personnel uses badge number, employee ID, and email as stable matches. Name-only matching is never used to update a person. Empty cells do not clear existing values.
- Firearms compare normalized serial/asset identifiers, validate active-department assignments, and block assignment conflicts. Missing make/model/caliber are explicitly warned and stored as `TBD / Unknown` only for creates.
- Certifications require an active-department person and an existing configured certification type. Duplicate identity uses credential number, then issue/expiration date.
- Vehicles use normalized VIN/unit identity and support current Fleet vehicle fields plus MDT, modem, MVR, and radar installed-asset serial/warranty fields.
- Equipment requires an existing configured equipment type and serial or asset identity. It validates person/location assignment exclusivity and never creates equipment types implicitly.

Runtime row failures are returned exactly and downloadable as a formula-injection-safe rejected-row CSV. A failure cannot be silent: result counts distinguish created, updated, skipped, failed, and warnings.
