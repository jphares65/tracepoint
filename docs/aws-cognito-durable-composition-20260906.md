# Durable Cognito establishment and refresh composition

Implemented the disabled PKCE establishment port. It verifies both signed tokens
and the stored nonce, resolves the stable TracePoint identity, validates matching
original authentication times, and persists the encrypted refresh family before
returning an opaque browser handle. The absolute one-day session ceiling starts
at original authentication and does not extend on refresh.

Four new integration tests passed against disposable loopback PostgreSQL with
the existing identity/session/refresh migrations. They prove:

- Signed initial establishment followed by rotation persists real state, consumes
  the old handle before exchange, and does not expose provider tokens.
- Invalid nonce or inconsistent authentication time produces no refresh family.
- Global logout during exchange prevents rotation completion.
- Identity revocation before refresh registration prevents a browser receipt.

The local PostgreSQL process was stopped and its uniquely named directory was
removed and checked absent. No Supabase project or AWS database was accessed.
TypeScript and changed-file ESLint passed. This is new composition coverage,
not a repeat of the completed full database bootstrap/restore rehearsals.

The initial access-session record can precede a later failed refresh registration;
no browser receipt or token is returned in that case, and the unused access record
expires on its short token lifetime. Activation still requires durable logout and
ordinary opaque-session resolution, application database/RLS compatibility, and
live supported-browser acceptance. No route or provider selector was activated.
Supabase remains the application authentication provider.

Weighted readiness remains **66.50%**. Disabled, locally validated composition
does not earn production authentication migration credit.

The later broad Windows run exposed the embedded PostgreSQL library's immediate
directory-deletion race in this fixture and the identity-mapping fixture. Both
harnesses now stop the process, validate their exact temporary paths, retry file
locks and verify directory absence themselves. Both leftovers were removed and
verified absent. The subsequent full application run passed **224/224** tests;
the script suite passed **66/66**, and TypeScript/changed-file lint passed.
