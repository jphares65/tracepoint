# Disabled Cognito token endpoint adapter

The server composition now includes a real HTTPS refresh/revocation adapter for
the configured public Cognito app client. It derives the hosted domain from the
existing exact environment/account/region gate, prohibits redirects and browser
credentials, uses a 15-second timeout, and never retries a request automatically.
Refresh responses are bounded to 64 KiB and require a new refresh token plus
bounded access/ID tokens and lifetime. Returned tokens are unverified server
values intended exclusively for the signed refresh coordinator.

This implements the refresh-token grant supported with rotation by the
[Cognito token endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html).
It uses neither a stored AWS access key nor a client secret. Provider revocation
failure remains unconfirmed rather than being reported as successful logout.

Validation: all 18 adapter, refresh and PKCE tests passed; TypeScript and
changed-file ESLint passed. Tests cover target/client binding, response limits,
redirect/error rejection, single request behavior, malformed/unrotated tokens,
and sanitized revocation failures. No live token exchange was performed in this
slice. The staging AWS session is expired, confirmed outside the sandbox using
only a sanitized error category.

No live route, provider selector, schema, AWS resource, production state or DNS
changed. Durable logout/session composition and live application compatibility
remain activation gates. Weighted readiness remains **66.50%**.
