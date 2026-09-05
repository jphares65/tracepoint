# Authentication callback and email origin repair

Live browser recovery failed with an unresolvable redirect destination. Read-only requests to both `/auth/confirm` and `/auth/callback` independently returned login redirects whose origin differed from the public staging site. The handlers used the request URL origin behind ECS; they now use the configured HTTPS application origin. Public acceptance and release evidence require both invalid-token paths to redirect to the correct staging login.

The shared authentication redirect boundary rejects backslashes, encoded network paths, control characters, malformed encoding and external URLs. Callback, confirmation and password setup use it. Invitation, activation and password-reset emails use deployment configuration instead of caller-controlled Origin or forwarded-host headers. Configuration is validated before these handlers mutate records.

Two regression tests cover internal redirect handling and trusted email origins. All 163 application tests, TypeScript and the configured Next production build passed. Changed-file lint retains one existing any annotation in the invitation handler; new code passes lint. Main production was not changed.

The disposable recovery harness now supports `--fixtures-only --browser-recovery`, using the supported confirmation endpoint, setup form, authenticated identity check, password login, one-time-token replay rejection and refresh-token revocation. Tokens, passwords, cookies and screenshots are not saved. The normal extended release acceptance now requires this browser flow. Email delivery for recovery remains distinct from the already delivered Brevo transactional test.
