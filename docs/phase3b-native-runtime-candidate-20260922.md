# Phase 3B AWS-native runtime candidate

Source baseline: `fcabd93e74aaacd22bdd1c943175e7565fb7e1d6`. Native reference lineage: `1225879`. This integration retains the current product code and ports only native provider/session adapters, provider-specific route changes, and the existing AWS SQL runtime contract. It has not been deployed and none of the SQL has been executed.

## Runtime boundary

- `TRACEPOINT_RUNTIME_PROVIDER_MODE=aws-native`, `TRACEPOINT_DATA_PROVIDER=postgres`, `TRACEPOINT_AUTH_PROVIDER=cognito`, `TRACEPOINT_STORAGE_PROVIDER=s3`, and `TRACEPOINT_EMAIL_PROVIDER=ses` are required together.
- Native application data uses the tenant-bound PostgreSQL client and verified RDS TLS. Shadow mode additionally pins the quarantined final RDS hostname. Native server access accepts only a mapped Cognito browser session; it never falls back to a Supabase application-data client.
- Native object operations select S3. The Supabase object adapter remains for the current bridge but is not selected in native mode.
- Shadow mode requires a distinct `https://shadow*.tracepointhq.com` site origin, suppresses application email before constructing an SES transport, and rejects Cognito identity mutations before database preparation. It does not create an alternate authentication system.
- The prebuild reachability gate rejects static Supabase-provider imports, unreviewed dynamic legacy imports, and unreviewed legacy endpoints. Reviewed dynamic imports remain in bridge-only branches to preserve the running public bridge.

## Existing schema contract carried forward

`database/aws/001`–`021` are copied from the native lineage because the runtime calls their provider-neutral authorization, Cognito session/lifecycle, onboarding-audit, platform, and tenant-isolation functions. Their presence in this candidate does not prove that the quarantined target has applied them. Validate the target schema and apply only reviewed, necessary migrations during the separate shadow-data preparation phase after target attestation.

## Remaining deployment gates

1. Establish a controlled shadow hostname/access route and corresponding Cognito callback configuration. No public DNS, ALB, or Cognito change is made by this candidate.
2. Prove the quarantined target schema matches the native runtime contract and confirm the migrated data includes a valid controlled test identity; production Cognito identity migration remains out of scope.
3. Verify the shadow task has only the intended RDS/S3/Cognito-read capabilities and no Supabase data/storage credentials or production notification path.
4. Run real shadow acceptance tests after deployment. A local build and unit tests do not establish end-to-end runtime behavior.

The public Supabase bridge remains authoritative until a separately approved cutover.
