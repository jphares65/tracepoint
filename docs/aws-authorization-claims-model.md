# Authorization claims model

## Token claims (minimal)

Validate `iss`, `aud`/client, `exp`, `iat`, `token_use`, `sub`, and a server-
controlled `application_subject_id`. Optional `authorization_version` allows
cache invalidation. Do not put department permission lists, support-mode targets,
platform-admin grants or sensitive profile fields into long-lived tokens.

## Authoritative database context

For every request resolve: application subject; active/disabled state; selected
department; active membership; assigned department role codes; current role-to-
permission mappings; platform-admin assignment; and explicit support-mode state.
Set transaction-local PostgreSQL settings only through the trusted data layer,
then let RLS/functions read them. Missing/invalid context denies.

## Isolation rules

- A membership in department A conveys nothing in department B.
- Configurable titles are display metadata, not permissions.
- Department roles map to current permissions in the department.
- Platform administration is separate from department administration and never
  inferred from email/domain/provider group.
- Support mode requires platform authorization, target department, expiry,
  reason/case identifier and dual actor/target audit attribution.
- Service identities use separate audiences/scopes and cannot impersonate users.

## Revocation

Disable provider account, revoke refresh tokens/sessions, deactivate memberships,
increment authorization version, evict caches and record one correlated audit
event. Authorization checks use fresh state for destructive/privileged actions.
