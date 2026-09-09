# Disabled Cognito HTTP transport

The server-only composition now exports a disabled Web Request/Response transport factory for login, PKCE callback, refresh and logout. No application route or provider selector was activated, and no infrastructure or database was changed.

Login, refresh and logout require POST, the exact configured application origin and acceptable fetch-site metadata. Callback accepts the cross-site authorization redirect only through the existing single-use PKCE state/nonce flow. Duplicate cookies or authorization parameters are rejected. Redirect destinations are fixed to the configured application/Cognito origins; return-to input cannot change them.

Responses use no-store/private caching, no-referrer and Secure/HttpOnly/SameSite=Lax host-only cookies. Only opaque session handles reach the browser. Provider ID/access/refresh tokens remain inside mandatory server ports. Session receipts have a bounded lifetime. Refresh failure clears the local handle without retrying. Logout requires durable revocation before redirecting through Cognito's hosted logout; persistence failure reports an unconfirmed logout instead of claiming success.

Seven focused tests pass, including the disabled gate, CSRF, callback replay, duplicate cookies/parameters, redirect injection, token-free responses, rotation failure, logout ordering and lifetime/target checks. Changed-file lint and TypeScript passed. The first sandboxed test attempt failed in the tsx OS-user lookup; the same focused suite passed outside the sandbox without an application workaround.

The transport deliberately requires establish/rotate/revoke ports. Live activation still requires their complete durable composition, signed refreshed-token checks, lifecycle handlers, and provider-compatible database/RLS access. Existing Supabase authentication remains selected. No migration percentage credit is added.
