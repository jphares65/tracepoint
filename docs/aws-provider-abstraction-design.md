# Provider abstraction design

## Decision

Do not introduce runtime provider switching yet. The current Supabase client
surface spans hundreds of PostgREST calls, RLS, Auth Admin and compensating
audit/storage behavior; a generic repository would conceal security semantics.
Instead introduce boundaries one bounded context at a time, with Supabase/Brevo
as the only implemented/default providers and any AWS selection throwing during
startup.

## Contracts

- `IdentityProvider`: authenticate/session/subject lifecycle only; authorization
  stays separate.
- `AuthorizationContextProvider`: subject, department, membership, roles,
  permissions, platform/support context; deny on incomplete state.
- Domain repositories: typed operations per armory/training/fleet/etc., never a
  generic `from(table)` escape hatch.
- `ObjectStore`: put/get-signed/delete/head using an opaque agency-scoped object ID.
- `EmailProvider`: send a typed message and return provider message ID/status;
  provider errors map to the current retry/failure contract.

Configuration is server-only: `TRACEPOINT_*_PROVIDER` defaults to the current
provider when absent. Allowed current values are `supabase` or `brevo`; `aws`,
`cognito`, `aurora`, `s3` and `ses` fail with “provider not implemented”. Client
bundles never receive provider secrets or privileged adapters.

## First conversion

Email is the smallest boundary (two direct Brevo senders), followed by Storage
(four attachment flows and one patch flow), then read-only domain repositories.
Auth and authorization are last. Implementation was intentionally deferred in
this pass because the repository has no test runner beyond build/lint and exact
Brevo error/retry payload parity cannot be proven without adding focused tests.
This follows the instruction to design rather than perform a broad risky rewrite.
