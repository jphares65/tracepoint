# Authentication cutover runbook

1. Freeze identity schema and export metadata/counts only under approval.
2. Create immutable Supabase-subject ↔ Cognito-sub mapping with uniqueness and
   append-only audit; never key by email.
3. Configure Cognito later in a dedicated auth stack with exact callbacks,
   auth-code + PKCE, no client secret in browser, protected message templates,
   deletion protection and log ownership.
4. Implement issuer-specific server adapters and tests while Supabase remains default.
5. Migrate internal/test cohort via explicit activation/password reset; verify
   membership, role, platform isolation and audit attribution.
6. Expand cohorts with metrics for success/failure/reset/support volume. Never
   accept both issuers without an explicit linked subject.
7. Before final switch, revoke/expire old sessions, block new Supabase enrollment,
   verify disabled users, and retain emergency configuration rollback.

Rollback routes the affected cohort to Supabase only if its account remains
valid and the mapping/audit trail is intact. A Cognito-authenticated write is not
rolled back by changing identity providers; preserve database changes and audit.
Stop on subject collision, account enumeration, cross-tenant access, lost actor
attribution, invalid cookie security, reset/invite failure or unexplained login drop.
