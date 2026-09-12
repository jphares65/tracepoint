# TracePoint production decision register — 2026-09-12

| Decision | State | Basis | Effect |
|---|---|---|---|
| Full AWS is the completed target; no Supabase, Vercel or Brevo runtime dependency | Owner-approved | Owner directives in the migration task | Binding; bridge is rollback-only |
| RDS PostgreSQL Single-AZ `db.t4g.small`, 20 GiB gp3 / 100 GiB maximum | Owner-approved Tier 1; deployment pending | 2026-09-12 cost-optimization directive | Retains private TLS/KMS, PITR, Backup and a GovCloud-portable RDS pattern; Multi-AZ is the scale-up trigger |
| One Fargate task behind one ALB, rolling maximum two | Owner-approved Tier 1; implementation complete | 2026-09-12 cost-optimization directive | Reuses validated foundation; no second runtime lineage |
| Cognito user pool with AWS-native session persistence | Owner-approved target; production execution pending | Cognito migration design and owner definition of complete | Passwords are reset, never copied |
| S3 private versioned bucket with KMS and AWS Backup | Owner-approved target; execution pending | Storage abstraction and full-AWS assembly | Two source objects in current scope |
| SES domain identity, Easy DKIM, custom MAIL FROM and two TLS configuration sets | Proposed exact implementation, owner/DNS approval pending | Email provider decision and SES checkpoint | Removes Brevo runtime dependency |
| Supabase retained sealed for seven days after successful cutover | Temporary rollback control | Owner directive to preserve rollback source | No runtime traffic; separate decommission approval |
| Compatibility service | Not approved and not used in final target | Owner prohibition on new permanent architecture | No PostgREST compatibility service in production target |
| Human operational alert mailbox | Owner-approved endpoint; live confirmation pending | Owner designated `contact@tracepointhq.com` | CDK requires the exact address; unconfirmed SNS subscription is a cutover blocker |
| Membership-less platform administrator migration | Unresolved | Read-only inventory found one such identity | Must not invent a department membership |
| Inactive-only identity migration | Proposed: import disabled with no email | Read-only inventory found one such identity | Requires explicit owner disposition |
| Production hard budget | Owner-approved $175/month target; live change pending | $131.72 steady / $144.38 rolling / $153.58 storage peak | Last-observed $150 budget must be updated before deployment |
| Public DNS remains owner-controlled at Wix | Owner-controlled external action | Current authoritative nameservers and DNS-deny guardrail | No automated DNS mutation |

No row in this register redefines migration completion. “Complete” remains
customer traffic on the full-AWS runtime with Supabase, Vercel and Brevo absent
from production runtime configuration, calls, credentials, backup and recovery.
