# Provider abstraction design

## Decision

Introduce boundaries one bounded context at a time. Supabase remains the only
database, identity, authorization, and storage implementation. Brevo remains the
only email implementation and default. No AWS provider is dormant or selectable.

## Contracts

- `IdentityProvider`: authentication/session/subject lifecycle only.
- `AuthorizationContextProvider`: subject, department, membership, roles,
  permissions, platform/support context; incomplete state denies access.
- Domain repositories: typed bounded operations, never a generic
  `from(table)` escape hatch.
- `ObjectStore`: put/get-signed/delete/head with opaque agency-scoped IDs.
- `EmailProvider`: send a typed message and return a provider message ID;
  provider response errors retain status and provider message for current caller
  mapping.

Configuration is server-only. The email boundary reads
`TRACEPOINT_EMAIL_PROVIDER`, defaults to `brevo`, and rejects every other value
as not implemented at first server-only construction. `BREVO_API_KEY` and
`TRACEPOINT_FROM_EMAIL` are read only in the server provider module. Client
bundles cannot import it because the entry point imports `server-only`.

## First conversion completed

Both direct Brevo callers (activation and queued digest) now use the typed email
boundary. Brevo endpoint, headers, sender, recipient shapes, subject/body
generation, message ID, activation error wording, digest retry calls, queue
states, and failure accounting are preserved. The queue and token workflows were
not moved into the provider.

Focused tests use Node's built-in runner and erasable TypeScript. No dependency
was added. Storage characterization is the next bounded candidate; database,
RLS, authorization, and Auth conversion remain deferred.
