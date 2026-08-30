# Open API readiness

All 80+ existing `/api/*` handlers are internal application endpoints except the
non-sensitive ALB health check. They mix cookie sessions, admin clients,
department context, UI-specific payloads and internal workflow/audit behavior;
none is approved for partner access. Platform, super-admin, support-mode,
onboarding, user lifecycle, data export, email dispatch and pilot endpoints must
not be exposed automatically.

The dormant `/api/v1` design uses separate controllers and DTOs, confidential
client identity, agency binding, scopes, cursor pagination, allowlisted filters,
RFC 9457-style errors, correlation IDs, idempotency on mutations, quotas and
audit. Proposed paths in the OpenAPI file are explicitly marked not implemented.

Readiness requires partner use cases/data contract, legal/data-owner approval,
field minimization, synthetic contract tests, tenant-negative tests, version
policy, rate limits, operational ownership, webhook design and an external
security review. Never route `/api/v1` directly to internal handlers.
