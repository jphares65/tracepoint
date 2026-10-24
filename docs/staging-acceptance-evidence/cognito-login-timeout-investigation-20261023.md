# Cognito acceptance login timeout investigation

## Finding

Run `4c66f928` did not reach the D-2, role-permission, or Agency B isolation checks because a Cognito re-login timed out. The run-specific JSON report and local fixture manifest are no longer present in the repository or the recorded local evidence locations. The retained status identifies a browser timeout during Cognito login but has no safe per-step browser snapshot. That is not enough to distinguish Playwright waiting, Cognito challenge state, redirect completion, or application session establishment.

## Source review

- The acceptance runner creates a new Playwright browser context for each synthetic user, so application cookies are not shared between role accounts.
- Browser requests are restricted to the staging app and its configured Cognito hosted UI origin.
- PKCE completion is established from the application callback response and redirect; application access checks begin only after the login helper returns.
- Before this correction, detailed sanitized URL class, MFA prompt, input visibility, callback status, and TOTP submission evidence was attached only if the final home-page wait timed out. Earlier redirect, username, MFA, and TOTP waits could escape with only a coarse phase.

## Correction and limits

The login helper now attaches the current safe step and a sanitized state snapshot to every thrown login error. The snapshot contains only host/path classes, callback status, TOTP submission count, and MFA/error/input booleans. It never records a URL query, page text, credentials, tokens, or MFA secret. The original Playwright error is preserved if snapshot collection itself fails.

This corrects the missing diagnostic evidence; it does not change Cognito, PKCE, MFA, session, or authorization behavior. The prior timeout's precise cause remains unclassified until the release coordinator clears staging and a new disposable run produces the per-step evidence. No live acceptance run was started for this investigation.
