# Production Cognito runtime boundary validation — 2026-09-13

`TracePointProductionBoundary` v16 is active and permits exactly the nine Cognito admin lifecycle calls used by the AWS-native runtime, only when the principal is `tracepoint-production-aws-native-ecs-task` and the resource is production pool `us-east-1_diFmWDMe9`. No SCP was changed. Boundary v15 remains available as the exact rollback.

The v15 canonical compact SHA-256 is `39acb70e0f81ae0f430de60eddf52ce37afea56b588451f552fdd313d005eacc`; v16 is `a24e22905394a7fc046a9550ff5c2488cfb67c0764fec877dafed45fd7ff7d65`. IAM Policy Autopilot 0.3.0 derived the nine admin actions from `src/lib/authentication/cognito-admin.ts`. Pre-change simulation showed Organizations allowed and the boundary denied every call. Post-change simulation shows both layers allow all nine. Cross-pool `AdminGetUser`, another role, `AdminAddUserToGroup`, `CreateUserPool`, and `iam:CreateUser` remain denied. Access Analyzer policy validation returned no findings.

The full boundary reached the IAM managed-policy size quota when the new exact action list was added. The deployed 6,143-character representation removes optional `Sid` labels and encodes the existing Route 53 `Null` false values as JSON booleans; this changes no existing action, resource, principal, or authorization condition. Oldest non-default v11 was removed only to free the required version slot. Rollback is:

```powershell
aws iam set-default-policy-version --policy-arn arn:aws:iam::193644343389:policy/TracePointProductionBoundary --version-id v15 --profile tracepoint-production
```

The runtime-role no-create task `22e311195b8e40adb3a3b8878ba4914c` exited 0 after `AdminGetUser` returned the expected `UserNotFoundException`; it created no identity and sent no email. An earlier validation-only attempt `3d83c69adbc74905a197c0ee91eb2929` exited before any AWS API call because a development-only package is not installed in the standalone image. The dependency-free reviewed probe corrected only the harness and passed.

A post-change read-only PostgreSQL task passed TLS, bounded `tracepoint_runtime`, non-superuser/non-bypass, 96 RLS-table, zero legacy `auth.uid()` policy, fail-closed synthetic tenant, and denied service-role-escalation checks. It performed no writes and read no customer data. ECS remains `1/1/0`, the ALB target is healthy, direct non-authoritative `/api/health` returned 200, all 17 alarms are `OK`, and the active account unused-access analyzer has zero active findings. The budget remains $150; the boundary adds no recurring cost.

Authenticated positive-path RBAC remains unexecuted. The repository's reviewed disposable three-user procedure is staging-only, while the authorization permits synthetic production identities only when an existing reviewed procedure supports them. A proposed production adaptation was stopped before execution. The pool remained at zero users; no synthetic database rows or credential objects were created, so no cleanup was required. Explicit approval of a production adaptation—suppressed Cognito creation, isolated synthetic database rows, encrypted temporary credential handling, and verified deletion—is required to complete that check.

Machine-readable sanitized evidence is in `docs/aws-cognito-runtime-boundary-validation-20260913.json`.
