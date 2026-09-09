# Disabled encrypted Cognito refresh persistence

Migration 67 adds only authentication_refresh_sessions. It is applied to isolated staging wztqqqashilusoppddxi, with an exact 67-migration ledger, RLS enabled, no browser grants/policies and zero rows. No Supabase session, Cognito selection or production configuration changed. The pinned-source staging command was rerun and proved idempotent.

The server-only composition exports a PostgreSQL refresh store with AES-256-GCM encryption, a bounded rotation keyring, purpose-specific authenticated encryption, hashed opaque handles and an exact issuer/client boundary. Ciphertext is bound to family, generation, handle hash, identity and original authentication/expiry. No refresh token or encryption key is written in plaintext by this store.

Consumption locks the row, clears its encrypted payload and commits a consumed state before returning the token to a trusted provider caller. Concurrent requests release it only once. A failed or ambiguous provider exchange remains consumed; restarting or using Cognito's grace period cannot retry that local exchange. Completion must follow signed matching-token verification by the caller, creates a new handle/generation and preserves the original absolute expiry. Original authenticatedAt must come from verified auth_time, never a refreshed token's iat.

Registration/completion serialize on the stable identity mapping and recheck global revocation. Family logout persists a revoked tombstone, so an in-flight completion cannot restore it. Other users or app clients cannot revoke or consume it. Mapping revocation, expiry, copied/tampered ciphertext, unavailable persistence and invalid inputs fail closed with sanitized errors. Consumed/revoked state remains until absolute expiry; only expired state is purged.

Ten real PostgreSQL tests cover encryption/key rotation, concurrent single consumption, ambiguous non-retry, identity/client mismatch, completion replay, family/global revocation races, inactive mapping, ciphertext copying, malformed inputs, browser denial, expiry and database-error suppression. Two source-integrity tests pin the exact reviewed additive migration across Windows line endings and reject DDL/DML/grant edits. The 67-migration standard PostgreSQL bootstrap and complete table/relationship/schema/RLS restore reconciliation passed in 2423 ms. Earlier AWS RDS rehearsal evidence still covers 66 migrations; it is not relabeled as a 67-migration AWS rehearsal.

The remaining activation work is the application cookie/refresh transport and signed refreshed-token composition, Cognito invite/reset/activation handlers, provider-to-database RLS integration and an end-to-end application cohort. The store is not a public refresh endpoint and never grants department permissions. No refresh secret or encryption key has been installed in the active runtime; no weighted migration credit is added.

Repeat the exact staging schema gate:

    node scripts/with-staging-aws-session.mjs node scripts/apply-staging-refresh-schema.mjs --execute

Evidence: aws-refresh-session-evidence-20260905.json. Staging remains on accepted revision 17; this disabled code has no active route import and needs no image deployment for current behavior.
