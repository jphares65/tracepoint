# Production synthetic Cognito authentication and RBAC validation

The owner-authorized, production-safe synthetic validation passed in AWS account `193644343389`, region `us-east-1`. Exactly three run-scoped identities represented an ordinary user, department administrator and foreign-tenant user. All addresses used the reserved `example.invalid` domain, Cognito creation used `MessageAction=SUPPRESS`, the SES send counter did not change, and no customer data, customer department or customer object was used.

All three identities authenticated with password plus mandatory software-token MFA through the production authorization-code/PKCE path. Token acceptance and current-session behavior passed. The administrator received `administer_department` and could read the privileged importer workspace endpoint. The ordinary user could read its permitted equipment endpoint but received HTTP 403 from the privileged endpoint. The foreign user resolved only its own synthetic tenant; a forged department cookie was ignored and the privileged endpoint returned HTTP 403. Direct PostgreSQL RLS checks returned zero cross-tenant rows.

Refresh rotation passed. Application logout rejected the ended session, and Cognito global sign-out caused both refresh and current-session requests to return HTTP 401. Browser request monitoring observed no Supabase, Vercel or Brevo request from the AWS-native path.

Cleanup passed before the result was accepted. The Cognito pool returned to zero users. Run-scoped database residue was zero for auth users, profiles, Cognito identity links, departments, memberships, membership roles, feature rows, access sessions and refresh sessions. No object was created. ECS remains active at desired/running/pending `1/1/0`, the ALB has one healthy target, all 17 metric alarms are `OK`, and the active account unused-access analyzer has zero active findings.

The procedure exposed and corrected four local harness defects: dependency resolution, Node entry-point command arguments, ECS log-stream derivation, and the missing idempotent profile upsert retained by the authoritative staging fixture. A Node DNS refusal was handled with a bounded read-only Windows resolver fallback. One Fargate task then experienced a pre-start transient image pull error; ECR immediately confirmed the exact immutable digest was ACTIVE, and the unchanged retry passed. Every failed attempt completed cleanup or rolled its database transaction back before another attempt.

Focused validation is 43/43: four fixture/harness tests plus 39 authentication, PKCE, refresh, durable session, proxy authorization and PostgreSQL authorization tests. `git diff --check` passes.

Implementation-prepared readiness remains **100%** and live-verified readiness remains **81%**. No points are claimed for this blocker-clearing validation because gate 8 specifically requires migration, activation and reconciliation of the real 96-user production cohort; that customer-impacting action remains unauthorized.

Machine-readable sanitized evidence is in `docs/aws-production-synthetic-auth-validation-20260913.json`. It contains no email aliases, passwords, tokens, MFA secrets, customer identifiers or record contents.
