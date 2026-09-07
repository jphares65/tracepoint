# TracePoint production AWS checkpoint — 2026-09-07

Formal weighted readiness advanced from **66.50% to 73.00%**. The increase is limited to the live dedicated production account, its organization controls, the exact production migration-role gate, and the deployed production network. The completed baseline, compute, image-build, and zero-finding immutable image are recorded but receive no extra credit because the unchanged checklist has no separate uncredited lines for them.

The dedicated runtime account is `193644343389` (`TracePoint-Production`) in `Root/Workloads/Production` (`ou-9qyd-crf8dgl2`), region `us-east-1`. The management account is not a runtime target. CDK bootstrap, account baseline, cost controls, network, security, compute, and image-build stacks are all `CREATE_COMPLETE` with termination protection. ECS is intentionally idle with zero services.

The production image for `ae3d2a4ce87b2085e251b1995f51a7b07058ec4d` is immutable and KMS-encrypted at digest `sha256:130cb32f05d3f8fad45eb9dfdae470dc2bf9769b128a3224f901554572ed98c3`. ECR scanning completed with zero findings at every reported severity. CodeBuild performed the production Next.js build and non-root/read-only-filesystem container gate.

The KMS-backed application secret has the four image-build fields only. Runtime remains fail-closed because the production Brevo credential is not available through local configuration and Vercel correctly redacts it. The concealed finalizer is [set-tracepoint-production-secret.ps1](../scripts/set-tracepoint-production-secret.ps1); it accepts the Brevo key through a masked prompt, retains the exact built values, generates an environment-specific notification secret, probes production Supabase public/admin and Brevo account endpoints, writes exactly eight fields atomically, and verifies the new version without printing values. Do not copy the staging secret.

The ACM certificate remains `PENDING_VALIDATION`. No DNS record or traffic was changed. The required validation-only record is:

- Name: `_cf183eaeec77acfda74681d687456469.tracepointhq.com.`
- Type: `CNAME`
- Value: `_09b5cb9ef970b57b1d638cd814364d07.jkddzztszm.acm-validations.aws.`

Production Supabase is healthy in `us-east-1`, but the live backup API reports PITR disabled and no available physical backup entries. No destructive restore was attempted. Enabling a paid recovery tier and executing an isolated restore require owner/data-owner approval; no recovery credit is claimed.

## Remaining blockers

Technical work after the two external inputs: finalize the full runtime secret; wait for ACM `ISSUED`; review the runtime/control/alert diff; deploy those three stacks; perform public/authenticated acceptance, bounded load/failure checks, alarm/queue/log gates, rollback/restore, and certificate/HTTPS validation. Runtime Supabase remains database/auth/storage and Brevo remains email; Cognito and SES remain disabled.

Account/permission work: establish and test a management-owned break-glass path before replacing `AdministratorAccess` on the migration role with derived routine deploy/image policies. Configure a named human/on-call notification recipient. Security Hub currently contains 13 informational coverage findings (five passing and eight services/features not enabled), with zero GuardDuty findings; these are coverage gaps, not threat findings.

Agency/business approval: approve a Supabase PITR/backup tier and isolated recovery target, object-recovery procedure, named on-call, and final cutover window. No production customer record may be mutated for evidence.

DNS/traffic authorization: authorize only the ACM validation CNAME above first. Production Route 53 alias/traffic cutover remains a separate explicit authorization after runtime acceptance and rollback evidence.

The current deployment authorization expires at `2026-09-08T15:28:15Z`. While valid, the single credential action is:

```powershell
$env:AWS_REGION='us-east-1'
$env:AWS_DEFAULT_REGION='us-east-1'
$env:TRACEPOINT_PRODUCTION_AUTHORIZATION='user-authorized-production-foundations-20260907'
.\scripts\set-tracepoint-production-secret.ps1 -Config infra/production-target-20260907.json
```

That command prompts for the production Brevo key without echoing it. If the authorization has expired, issue a fresh bounded deployment authorization and update only the non-secret target expiry/reference before running it.
