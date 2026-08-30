# Integration security model

- One confidential OAuth client per partner/application/environment; no shared
  API keys. Client credentials use short-lived access tokens and rotatable secret
  or private-key authentication. Human cookies are rejected.
- Server maps client to explicit agencies and least-privilege scopes. The path
  agency must equal an allowed agency; database context repeats the check.
- Mutations require idempotency key scoped to client+agency+operation, canonical
  request hash, bounded retention and conflict response on key reuse.
- Cursor pagination is opaque/signed; filters and sort fields are allowlisted.
- Rate limits apply per client, agency and endpoint with 429/Retry-After; emergency
  disable is audited.
- Every request records client, agency, scope, operation, outcome, correlation ID,
  latency and minimized entity identifiers without secrets/payload bodies.
- Webhooks use per-subscription secret or asymmetric signing over timestamp,
  delivery ID and raw body; reject stale timestamps/replays; retry with backoff,
  DLQ and receiver-visible delivery IDs.
- Version additions remain backward compatible; breaking changes use a new major
  path, published deprecation/sunset dates and observed-consumer migration.
- Data minimization is deny-by-default. Platform/admin endpoints, internal notes,
  auth data, audit internals and cross-agency aggregates are excluded unless a
  separately approved contract says otherwise.
