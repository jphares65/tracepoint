# Cognito migration design

Supabase Auth remains authoritative. Cognito is a proposed coexistence target,
not configured or reachable.

## Identity strategy

Keep the current Supabase UUID as immutable `application_subject_id`. Cognito
`sub` is provider-owned and maps one-to-one in a protected identity-link table.
All existing data/audit foreign keys continue using the application subject.
Email is a mutable login/contact attribute, never the relational key.

Password hashes cannot be exported from Supabase Auth through normal supported
flows. Transparent bulk password transfer is therefore not assumed. Preferred
coexistence: existing users authenticate with Supabase until they complete an
explicit Cognito activation/reset; new invited users can enter Cognito only in a
controlled cohort. A just-in-time migration trigger is considered only if a
secure source credential-verification API is explicitly supported and approved.

## Behavior mapping

| Current behavior | Cognito/coexistence design |
|---|---|
| password and email OTP | user-pool auth-code/PKCE or application UI; preserve UX contract |
| invite/create user | admin create/invite adapter plus application profile transaction |
| activation token/password assignment | application one-time token maps subject, then Cognito set-password flow |
| reset email | Cognito forgot-password or approved custom message; avoid account enumeration |
| Supabase cookies | encrypted, HttpOnly, Secure, SameSite application session cookies; no tokens in browser storage |
| proxy `getClaims` | server-side JWT issuer/audience/expiry/token-use validation with cached JWKS |
| membership/roles | database authorization service, not Cognito groups |
| platform admin | isolated database assignment and explicit claim, never self-service |
| disable/offboard | disable provider account, revoke sessions, deactivate memberships, audit |

MFA is not currently implemented in code. Introduce optional/policy-driven MFA
as a separate behavior change, then require it for platform and privileged roles
before production. Session duration and inactivity must preserve the existing
IdleSessionGuard behavior while server-side expiry remains authoritative.

## Coexistence

Add a dormant provider discriminator to identity links; accept only the
explicitly enabled issuer; never silently fall back after a failed Cognito token.
Run cohorts, dual audit attribution and reversible routing. Do not mint a token
claim for every fine-grained permission: roles are department-configurable and
can change mid-session, so resolve them from the authorization store and use a
short cache/version claim only.

## Cutover gates

Subject mapping complete, invitation/reset templates approved, cookie/JWT tests,
MFA decision, disabled-user/session-revocation tests, platform isolation,
cross-agency negatives, help-desk recovery, audit continuity and emergency
issuer rollback rehearsed. Supabase Auth is retained until all active users are
migrated or an approved recovery path exists.
