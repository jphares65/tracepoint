# AWS security control matrix

This is CJIS-aligned planning, not a claim of CJIS certification or compliance.

| Control area | Staging requirement | Production gate | Owner / evidence |
|---|---|---|---|
| Account separation | dedicated member account, management-account deny guard | separate production account/OU and SCP | platform; Organizations inventory |
| Identity | Identity Center, MFA, short sessions, separate deploy/operator/security roles | reviewed joiner/mover/leaver and break-glass test | identity owner; assignments/audit |
| Least privilege | bounded deployer/pass-role, empty task role | Access Analyzer/policy review, no admin deployment | platform/app; policy artifacts |
| Encryption | TLS; KMS for secrets/logs/data | rotation/restore and key-owner evidence | platform/data owners |
| Secrets | retained secret, no IaC values, BuildKit mount | rotation rehearsal, leak scan, revocation | platform/app |
| Network | ALB-only task ingress, no SSH | WAF decision, egress review, private DB/data tiers | platform; synth/diff/tests |
| Tenant isolation | department checks plus RLS | exhaustive negative matrix and independent review | app/data security |
| Logging/audit | app/ALB/flow logs; actor/agency correlation | immutable central retention and access review | security/platform |
| Threat posture | separate GuardDuty/Security Hub/Config baseline | delegated admin, response routing, control exceptions | security team |
| Vulnerability | immutable ECR scan-on-push; dependency scan | blocking severity/SLA policy and container scan evidence | app/security |
| Recovery | retained stateful resources; documented runbooks | PITR/restore and regional/account recovery exercise | data/platform |
| Cost governance | application/environment/managed-by/data tags | owner/cost-center tags and separately approved alerts | FinOps/platform |
| Promotion | local synth/build/lint | image provenance, real diff, canary, rollback approval | change owner |

AWS secures facilities and managed-service infrastructure; TracePoint owns data
classification, IAM, configuration, application authorization, secrets, patch/
image lifecycle, logging review, backup policy and incident handling.
