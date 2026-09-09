# Full-AWS architecture assumption audit

## Binding target

Migration completion means the production application has no runtime dependency
on Supabase for database, Auth, Storage, Realtime, Edge Functions, credentials,
backup, or recovery. Supabase is a temporary source and rollback system only.
The retained-provider deployment is a migration bridge, not a permanent target.
The final implementation must use AWS services and retain a practical GovCloud
portability path.

The historical 79.00% is therefore **hybrid AWS-hosting readiness**. The
corrected target-state score is **42/100** under
`aws-full-migration-rebaseline-20260908.json`.

## Assumption chronology

- `a836422` first awarded readiness credit to working Supabase/Brevo bridge
  configuration.
- `336033e` made `retain-production-providers` the only executable production
  target mode.
- `6fafa38` made those bridge pins invariants of the recovery, secret, and cost
  model.
- `bb921ca` advanced the mixed checklist to 79% without adding provider-exit or
  decommissioning gates.

No document records owner approval of permanent hybrid operation. The error was
using an initial-hosting checklist as the definition of total migration.

## Component decisions and remaining work

| Component | Current implementation | Final AWS implementation | Decision provenance/status | Non-AWS runtime/cost | Remaining focused engineering |
|---|---|---|---|---|---:|
| Hosting/deployment | ECS/Fargate, ALB, ACM, WAF, ECR and CodeBuild are live and reusable | Retain; make provider-free runtime assembly and narrow egress | Existing AWS work is approved and validated | None after legacy Vercel rollback window | 6–12h |
| PostgreSQL | Supabase Postgres/PostgREST; no RDS/Aurora exists in staging or production | Aurora PostgreSQL is documented primary; provisioned RDS is documented steady-small alternative | Target class documented; exact engine/topology is unresolved owner decision | Supabase plan until cutover | 30–44h application/data work plus 6–10h target infrastructure |
| Authentication | Supabase Auth is authoritative; staging Cognito pool exists but provider is disabled | Cognito user pool, server-verified tokens, protected identity link, application sessions | Cognito design documented; activation and user migration require owner authorization | Supabase Auth until all users are recoverable | 14–20h staging plus user activation elapsed time |
| RLS/tenant isolation | 144 `auth.uid()` occurrences; browser/user calls rely on Supabase claims; service role bypasses RLS | Non-owner PostgreSQL application role with transaction-local immutable subject and deny-by-default policies | Approach documented in data migration runbook; implementation incomplete | None after conversion | 8–14h, overlapping database conversion |
| Object storage | S3 provider and private versioned staging bucket are active; production still selects Supabase Storage | Private S3, task-role access, KMS/versioning, short signed access, checksum/orphan reconciliation | S3 target documented and partially validated | Supabase Storage until object cutover | 3–6h staging plus production copy window |
| Email | Brevo factory is active; SES foundation is prepared but disabled | SES v2, configuration set, SNS/SQS feedback and durable database consumer | Brevo retention was a temporary sequence; sender/on-call addresses unresolved | Brevo usage/plan, amount not recorded | 12–20h plus SES/DNS external elapsed time |
| Secrets/keys | KMS/Secrets Manager exist, but one secret is schema-locked to Supabase/Brevo; import HMAC can fall back to Supabase key | Separate RDS-managed credentials, dedicated import/session keys, task roles for S3/SES | AWS mechanism approved; vendor-shaped schema and key reuse are engineering assumptions | Vendor keys until exit | 4–7h |
| Backup/PITR/DR | ECS rollback and versioned S3 exist; no AWS DB or AWS Backup vault; Supabase PITR disabled | RDS/Aurora automated backup/PITR and timed restore; S3 version restore; AWS Backup/copy if RPO requires | Target documented; RPO/RTO/retention/copy policy unresolved | Supabase backup only as temporary source protection | 8–14h after data targets exist |
| DNS/certificates | ACM issued and AWS runtime healthy before public DNS | Route 53/authoritative DNS alias to ALB with rehearsed rollback | AWS target documented; DNS write/window owner-gated | Vercel remains current origin/rollback until cutover | 2–4h plus propagation |
| Monitoring/alerting | CloudWatch/WAF/CloudTrail/security services and machine SQS alarm path are live | Add database, Cognito, SES/worker and recovery alarms; separately approved human endpoint | Existing AWS monitoring reusable; transactional sender was incorrectly assumed to be on-call | None after approved mailbox | 4–8h |
| CI/CD | GitHub OIDC and immutable AWS publish/deploy/rollback work; Vercel Preview is a mandatory gate | AWS staging acceptance as gate; protected production workflow; CodePipeline optional if AWS-only control plane required | GitHub is not runtime; Vercel gate is an engineering assumption | Possible GitHub/Vercel plan, unrecorded | 6–10h, or 12–20h for CodePipeline replacement |
| AI | Deterministic importer works; Bedrock provider is implemented but not runtime-authorized | Deterministic mode or Bedrock Converse with least-privilege task role | Model/residency/cost owner decision unresolved | No direct OpenAI/Anthropic credential; Bedrock usage is AWS-billed | 2–4h plus model decision |
| Realtime/Edge Functions | No source subscription or Edge Function invocation found | No replacement required; future schedules/jobs use EventBridge plus ECS/Lambda | Source-confirmed absent; live metadata check remains | None evidenced | <1h metadata verification |
| GovCloud portability | Commercial partition, `us-east-1`, AZ, Cognito-domain and other literals remain | Partition/region/account configuration, FIPS-compatible endpoints, mirrored artifacts and GovCloud synth | Portability is approved target quality; actual destination account is not available | Build-time Docker Hub/GCR/npm/GitHub dependencies remain | 8–14h after provider exit |

## Unapproved or implicit assumptions

1. A retained-provider bridge was encoded as the only production data mode.
2. Supabase configuration and browser acceptance were counted as Auth migration.
3. Supabase schema/manifest validation was counted as completed data migration.
4. Storage was scored 100% although production still selects Supabase Storage.
5. Brevo configuration was counted as email migration.
6. Provider interfaces were counted without an AWS database implementation.
7. Supabase PITR was treated as a final recovery gate rather than optional
   temporary source protection.
8. The checklist omitted removal of 601 data calls, Supabase packages,
   credentials, egress, production object migration, and decommissioning.
9. Public-IP ECS tasks and unrestricted TCP 443 egress were treated as a durable
   network shape without a full-AWS/GovCloud decision.
10. Vercel Preview was made an AWS release prerequisite.
11. `contact@tracepointhq.com` was assumed to be both transactional sender and
    human on-call recipient.
12. Aurora Serverless was called primary without choosing it over provisioned
    RDS from measured workload and cost.
13. Retention periods, DMARC posture, RPO/RTO, and recovery-copy topology were
    engineering assumptions rather than owner decisions.
14. Notification and migration-workspace scheduler ownership was left undefined.
15. The Supabase service key was allowed as an importer signing-key fallback.
16. Commercial-partition and `us-east-1` literals were treated as GovCloud
    portable.
17. Hybrid cost estimates excluded Supabase, Brevo, Vercel, the final AWS
    database, Cognito usage, SES volume, and permanent backup storage.

## Fastest staging critical path

1. Correct governance gates and current migration count; validate current
   logical restore: 2–4h.
2. Provision isolated managed PostgreSQL and roles/TLS/secret/backup: 6–10h.
3. Add pooled PostgreSQL transport and transaction-local authorization: 6–8h.
4. Convert remaining server reads/RPCs/mutations and 28 browser calls: 24–36h.
5. Activate Cognito with synthetic users and lifecycle/session parity: 14–20h.
6. Finish S3 metadata/reference and restore parity: 3–6h, parallel with 4–5.
7. Wire SES and feedback worker: 12–20h, parallel with 4–5.
8. Remove Supabase keys/packages/fallbacks/egress and prove zero dependency:
   3–5h.
9. Full AWS staging parity, database/S3 restore, focused regression, rollback,
   and GovCloud-compatible synth: 12–20h.

The dependency-critical path is approximately 48–70 focused hours. With
coordinated parallel lanes it is credible in 5–8 focused working days; a single
writer requires roughly 8–12 focused days. No external calendar blocker exists
for synthetic staging except authority to create a paid managed PostgreSQL
target. Production user activation, data movement, SES production access, DNS,
and decommissioning remain separately authorized.
