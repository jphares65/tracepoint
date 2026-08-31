# AWS production readiness gates

Every gate requires named owner, dated evidence and rollback. “Not applicable”
requires security/platform approval.

1. Separate staging/production accounts and SCPs; no management-account workload.
2. Architecture, threat model, data classification and CJIS-aligned control review.
3. Management-owned emergency path tested; one-time bootstrap separated from
   routine deployer and image publisher; `AdministratorAccess` removed only
   after fresh-session positive/negative tests and Access Analyzer review. See
   `aws-iam-access-transition.md`.
4. Signed/scanned immutable image, SBOM, dependency scan and patch SLA.
5. Exact DNS/certificate/WAF decision; TLS and headers externally tested.
6. Tenant-negative authorization suite, platform/support-mode isolation and audit continuity.
7. Secret rotation, build-secret handling and emergency revocation rehearsed.
8. Database migration rehearsed twice; validation exact; PITR restore and rollback timed.
9. Storage checksum/reconciliation, malware quarantine and retention approved.
10. Auth coexistence/cutover, MFA policy, disablement and help-desk recovery tested.
11. CloudTrail, GuardDuty, Security Hub and Config centrally owned; findings routed.
12. Actionable ALB/ECS/application/database/queue alarms and on-call escalation tested.
13. Load/failure/capacity/connection tests meet objectives; multi-task/cache decision revisited.
14. Cost model, mandatory tags and separately approved budget/anomaly alerts reviewed.
15. Change set shows no unexpected replacement/deletion/IAM broadening; canary and rollback approved.
16. Data owner and agency pilot approve cutover; no live-agency cutover without a separate change window.
