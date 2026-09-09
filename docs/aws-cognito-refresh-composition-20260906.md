# Cognito refresh composition checkpoint

Implemented a disabled server refresh coordinator over the existing durable
PostgreSQL refresh-family store. It consumes the handle before one exchange,
verifies both signed tokens, checks the original subject, client, stable user
mapping and authentication time, registers and checks the access session, then
commits a rotated handle with the original absolute expiration.

Provider tokens never enter its result. Failure revokes the family when possible;
the already-consumed payload remains unusable even if revocation persistence
fails. The caller must begin a new sign-in after ambiguous acceptance.

Validation: seven focused tests passed; TypeScript and changed-file ESLint passed.
Coverage includes mismatched subject/client/authentication time, bad signatures,
changed stable mappings, suppressed provider errors, failed durable completion,
unrotated responses and concurrent handle use. Tests use synthetic signed JWTs
and an in-memory contract double. Existing PostgreSQL store tests are separate;
this checkpoint does not claim a live composed refresh test.

No active route or provider selector changed. Remaining activation work includes
a target-gated exchange adapter with retries disabled, durable logout composition,
application session/RLS integration and live end-to-end acceptance. Supabase
authentication remains operational. No schema change or AWS mutation occurred.

The staging credential gate failed both inside and outside the network sandbox
during this continuation. Live mutations remain blocked until exact identity
verification succeeds. Main integration also remains deferred pending the
separate production qualification/Training Alerts hotfix and ledger comparison.

Weighted readiness remains **66.50%**; this disabled composition earns no live
authentication migration credit.
