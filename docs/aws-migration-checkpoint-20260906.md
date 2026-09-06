# TracePoint AWS continuation checkpoint - September 6

**Staging operational; not production cutover-ready; not fully migrated.**
Continuation score **66.50% -> 66.50%**. Original overnight baseline: 45.55%.
No credit was added for disabled provider code, documentation or another health
read. The calculation retains the existing weighted capability checklist.

## Implemented and validated in this continuation

- Disabled Cognito HTTP login/callback/refresh/logout transport with origin,
  one-time PKCE, cookie, redirect and token-disclosure protections.
- Signed refresh coordination with original identity/authentication-time binding,
  durable consumption before exchange, no ambiguous retry and fixed expiry.
- Fixed-target HTTPS token rotation/revocation adapter and durable initial
  establishment. Real local PostgreSQL integration proves rotation/logout races
  and identity-removal denial. Supabase authentication remains selected.
- Exact migration-source/ledger provenance comparison. Different SQL under the
  same identifier cannot pass as equivalent; missing ledger evidence blocks
  integration. Neither production ledger nor customer data was queried here.
- SNS partition/region validation shared by signature verification and feedback
  construction. GovCloud service differences and concrete code gaps recorded.
- Persistent SES feedback preserves explicit opt-outs and complaint provenance
  when later provider events arrive. SES remains disabled; Brevo remains selected.
- Operations-only GitHub OIDC workflow with a compact explicit read allowlist,
  reviewed-parent request gate, shared release concurrency, sanitized runtime,
  budget and log-classification evidence. No local AWS session is needed for it.
- Reliable cleanup of the three observed Windows PostgreSQL test fixtures, with
  exact-path checks, bounded lock retries and verified directory absence.

Final broad application validation: **224/224 passed**. Script safety suite:
**66/66 passed** before the final focused diagnostic addition; that diagnostic's
eight focused tests also passed. TypeScript and changed-file lint passed.
Two broad application teardown failures and two earlier SES teardown failures
were repaired; the exact leftover directories were removed and verified absent.
No new schema migration or AWS infrastructure mutation occurred in this run.

## Live evidence at 2026-09-06T14:25Z

Latest operations run: 34039086599, request commit 366a0cd371e72ad2a38941254fcc0c531fb7245e.
OIDC acquisition, exact identity verification and budget collection succeeded.
The overall job failed the existing strict task-lifetime log gate.

| Check | Evidence |
|---|---|
| Account / region / role | 559054714699 / us-east-1 / required TracePointMigrationStaging assumed-role pattern verified |
| CloudFormation | Runtime UPDATE_COMPLETE |
| ECS | Revision 18; desired/running/pending 1/1/0; completed rollout |
| ALB | One healthy target |
| Immutable image | af8304f40bad8ccd7336b35cacd026a89be5149a |
| Digest | sha256:6a4c9d5dfb5d89b9d2b9d1be2c3dab2a0abba8fa73aa70da401c00b6c1b8f503 |
| Scan | COMPLETE, zero findings; running digest matches |
| Alarms | All six OK, including request-flood and composite runtime alarm |
| Public routes | All 12 checks passed; health/login 200 and protected routes redirect to login |
| Notification queue | Failed/stale-processing 0/0, staging HEAD-only counts |
| Logs | Ten historical matches, zero in the last 60 minutes; no filesystem errors |
| Cost | Budget actual $2.983 / $75; model $68.67 plus $2 reserve; Cost Explorer unavailable to restricted role |

Eight log events match rejected Server Action requests. Two remain unclassified,
with fingerprints retained. All ten occurred between 12:06:43.605Z and
12:06:45.833Z. Fixed-vocabulary diagnostics disclosed no raw messages and did not
establish the cause of the other two. They are not assumed benign. No historical
error was filtered out to make the gate pass.

No new image was published or deployed: the separate production qualification /
Training Alerts hotfix has not appeared on main. Latest fetched main remains
e33e4a4f17b662dddec9bf653ebf4051c3eb78ab. Its worktree, branch, deployment and
Supabase operations were left untouched.

Authenticated acceptance, S3 upload/download/audit/cleanup, actual Brevo delivery
and rollback remain the prior **same-image** release-18 evidence, not rerun claims:
OIDC release run 33974564913; Brevo delivered 2026-09-05T16:11:35Z; rollback
18 -> 17 in 411.973 seconds and restoration 17 -> 18 in 421.528 seconds.
The current runtime is still the restored revision 18.

## Weighted accounting

Percentages below are the unchanged existing checklist's validated capability
fractions. Storage and CI/CD at 100% describe that checklist's staging capabilities,
not production object migration or an executed production pipeline.

| Category | Weight | Complete | Evidence / exact remaining work | Codex without new user input? |
|---|---:|---:|---|---|
| AWS account/governance | 6 | 50% | Isolated staging and identity gates proven; production authority and organization controls remain | No for account/authority |
| Network and compute | 10 | 60% | Staging ECS/ALB healthy; production network and load/failure validation remain | After production authority |
| Runtime deployment | 8 | 75% | Immutable release 18 live; production runtime not deployed | After production authority |
| Database/schema/data | 16 | 62.5% | Prior 67-migration staging ledger/local restore; AWS rehearsal covered 66; production transfer/PITR remain | No production data authority; main lineage must settle first |
| Authentication | 10 | 60% | Staging Supabase acceptance and disabled Cognito protocol foundations; application session/lifecycle/RLS activation and cutover remain | Further code after lineage reconciliation; live activation gated |
| Storage | 8 | 100% | Staging private S3, tenant delivery, synthetic copy/restore proven; production still uses Supabase storage | Production transfer requires separate authority |
| Email | 6 | 50% | Brevo delivery proven; SES real delivery and persistent worker activation remain | DNS/sender prerequisites and trusted worker configuration needed |
| DNS/TLS | 8 | 50% | Staging issued TLS/hostname; production certificate and DNS cutover remain | No production DNS authority |
| CI/CD | 8 | 100% | Staging OIDC publish/deploy/rollback proven; new restricted read-only operations executed | Staging release after stable main and gates |
| Security/monitoring/backups | 10 | 75% | Alarms/WAF/retention and staging recovery evidence; human escalation, historical log triage and production restore remain | Mixed: human destination/production authority required |
| Production account readiness | 6 | 50% | Strict offline five-stack assembly and production publication gates; live exact account/role unavailable | No |
| Cutover/rollback validation | 4 | 50% | Actual staging rollback/return proven; production DNS rollback and agency approval remain | No |

Weighted sum: **66.50 / 100**. This is readiness accounting, not a claim that
66.50% of production customer data/services have moved.

## Shortest critical path before Wednesday, September 9

1. Let the separate qualification/Training Alerts hotfix session finish, push and
   establish a stable production deployment. Do not integrate an intermediate main.
2. Compare exact SQL plus production/staging ledger metadata after that session
   finishes. Preserve production-applied identifiers, create unique forward-only
   reconciliation, and pass clean bootstrap plus both upgrade paths.
3. Complete final source validation and branch Preview; use the existing OIDC
   release workflow to publish a new immutable image, require a clean scan and
   reviewed structural/CDK gates, then deploy staging. Exercise the final
   qualification/Training Alerts and other authenticated workflows, S3/Brevo,
   alarms/logs, and controlled rollback/return.
4. Jason must identify/authorize the dedicated production account, exact
   TracePointMigrationProduction role and short-lived profile in us-east-1. Do
   not create or operate it through management account 265544358665 in this run.
5. Install production-only configuration and publish a separate production image;
   validate certificate, synthetic acceptance, monitoring/backup/recovery and a
   production diff under separate authority. The first hosting cutover can retain
   production Supabase database/auth/storage and Brevo, avoiding a data transfer.
6. Obtain the named monitoring contact and agency change window, then separately
   approve the production DNS/traffic cutover and rollback sequence. No such
   production action is authorized or executed here.

Jason's immediate prerequisites: finish the separate hotfix; supply the dedicated
production account/role authority; restore the expired local staging session for
foundation work outside the OIDC role's limited permissions; privately review the
two unclassified events in /tracepoint/staging/application at the exact UTC burst
above; provide the alarm acknowledgement destination. SES DNS/sandbox approval is
needed only for provider exit, not the first hosting cutover retaining Brevo.

Remaining Codex execution is the final main reconciliation/release sequence and
provider activation engineering after its database/session and live prerequisites
are available. S3 is live in staging; SES and Cognito remain disabled; standard
PostgreSQL rehearsal evidence is retained but no production database is moved.
No completed inventory or full database rehearsal was repeated in this run.

## Pushed commits preceding this final evidence checkpoint

- a9481a65e03bbe88910c2d1c31944ab9b0f2137d Prepare disabled Cognito HTTP transport with origin and cookie safety gates
- 755ad712fea09039c61eda976d98012c087ad900 Gate main integration on exact migration SQL and applied ledger provenance
- 1736d631f3306d06d09d3174a481654c5625fef2 Verify rotated Cognito sessions against durable original identity
- 45b21a7c355a9a6cac683e2fb93211afc1be18c2 Add fixed-target Cognito refresh and revocation transport
- dda16b2f5264b0ff2d2840d6c5d53383fab412e0 Reject mismatched SNS partitions and record GovCloud boundaries
- bc51433e1dde039931a02bc9a9b92b413704dbf2 Add read-only staging operations through restricted GitHub OIDC
- e00afe8cffc642469c38c34804ed76163924f4fa Request read-only OIDC evidence for accepted staging revision 18
- 13baaebbfdf523a3b024574f1169e40e8229a0ab Use an explicit read-only STS session policy for operations
- dd66e3494028622b4a3f79df3c5f81b978a17f2e Request staging evidence with the corrected read-only session policy
- 130f437563a3412c77adfff45ee16e60a496ddc7 Fit read-only OIDC operations within the STS packed policy limit
- 1791a34caceeebb9a7c618237165b5dd2f282066 Request staging operations with compact read-only OIDC permissions
- c88ec4e17285e82261b1fc6082fd9c63a3a8c07b Compose signed Cognito establishment with durable refresh registration
- 4faad9d0c83eefbc065d7fbe517e1fbcf155f3b3 Record live OIDC operations and add sanitized error classification
- c7a113051579417f1f085ba4dc767ba25c469bd4 Request read-only staging error classification
- 3e33d8a171f3e6651696086d8dfc75cdd9fd17fc Preserve SES opt-out and complaint suppression provenance
- 068daf97db8cf7855fd2d0280b87a1621caf90a5 Classify staging log matches within the existing evidence read
- f2001e6ec32bdfcedad35c0f4185f468262865b2 Request integrated staging log classification through OIDC
- f3917e4800708de079a3bc4fb64be6857f437eb9 Record historical staging error burst and bounded diagnostic features
- cf99f2ec84dcbcf7a5a34273e486101b4fd67fab Request bounded staging error features without raw messages
- 0ae29ff9e49d21a4afdf4c16455e5259f89722d8 Make Cognito PostgreSQL fixture cleanup reliable on Windows
- 2f9229157dc46fb98e7b2a3c26f21ef81260d7a0 Recognize bounded transport error features without message disclosure
- 366a0cd371e72ad2a38941254fcc0c531fb7245e Request read-only transport error classification
