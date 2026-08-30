# TracePoint AWS Migration Baseline

**Assessment date:** 2026-08-29
**AWS account:** `265544358665`
**Region:** `us-east-1`
**Identity:** staging IAM Identity Center migration role (session name redacted)

## Scope and safety

This is a read-only comparison of the TracePoint repository with the staging AWS account. The inventory used AWS STS and read/list/describe operations only. It did not retrieve secret values, inspect S3 objects, create or change resources, bootstrap CDK, deploy stacks, or access production.

## Executive summary

The staging account contains no deployed TracePoint application foundation. The only network is the AWS default VPC and its six public default subnets. No CloudFormation stacks, TracePoint-tagged AWS workload resources, S3 buckets, customer-managed KMS aliases, ECR repositories, ECS clusters or task definitions, CloudWatch log groups or alarms, Secrets Manager secrets, CloudTrail trails, GuardDuty detectors, AWS Config recorders/channels, RDS databases, Cognito user pools, load balancers, WAF ACLs, certificates, hosted zones, SES identities, queues, EventBridge rules, Lambda functions, API Gateways, or backup vaults were found.

The repository contains a CDK Phase 1 foundation, but it has not been deployed. The application remains a Next.js 16.2.6 application whose database, row-level authorization, RPC logic, authentication, and object storage are implemented in Supabase. Email delivery calls Brevo directly. The repository has no Dockerfile and the CDK intentionally stops before an ECS task definition, ECS service, load balancer, database, Cognito, DNS, WAF, or messaging resources.

The safest migration is therefore incremental: deploy and validate the AWS foundation first; containerize and run the existing application against Supabase next; migrate Supabase Storage, email dispatch, authentication, and PostgreSQL in separately tested stages; and cut over only after reconciliation and rollback exercises. Database and identity migration are consequential architecture decisions and should not be bundled into the initial hosting move.

## Repository architecture and dependencies

### Application runtime

- Next.js `16.2.6`, App Router, React `19.2.4`, TypeScript.
- Server-rendered pages and numerous route handlers require a full Node.js runtime; this is not a static-export workload.
- The current `next.config.ts` does not enable standalone output.
- No `Dockerfile`, `.dockerignore`, ECS task definition, ECS service, or load balancer configuration exists.
- Public assets are local under `public/`; user-generated evidence and attachments use Supabase Storage.

### Data, identity, and authorization

- `@supabase/ssr` and `@supabase/supabase-js` provide browser/server clients and session handling.
- Supabase Auth is called directly for password, OTP, session, sign-out, password-reset, and administrative user flows.
- The `supabase/migrations/` directory contains the relational schema, RLS policies, functions/RPCs, audit behavior, notification queues, and business rules.
- Server administration depends on `SUPABASE_SECRET_KEY` (with legacy `SUPABASE_SERVICE_ROLE_KEY` fallback).
- Client bundles require `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; because these are `NEXT_PUBLIC_` variables, they are fixed at `next build` time.
- File upload/download/delete routes call Supabase Storage directly. The CDK attachments bucket is not yet integrated with application code.

### External integrations and configuration

- Brevo REST API is used for email delivery via `BREVO_API_KEY` and `TRACEPOINT_FROM_EMAIL`.
- Notification dispatch accepts `NOTIFICATION_DISPATCH_SECRET` or `CRON_SECRET`.
- `NEXT_PUBLIC_SITE_URL` is used to construct application links.
- The checked-in `.env.local.example` documents only a subset of the variables used by the application; no secret values were read or copied into this report.

### Existing CDK design

The un-deployed `infra/` project defines five stacks:

1. `NetworkStack`: `10.40.0.0/16`, two Availability Zones, public/private/isolated subnets, one NAT gateway, VPC Flow Logs, and S3/Secrets Manager/ECR/CloudWatch Logs endpoints.
2. `SecurityStack`: a rotating customer-managed KMS key, retained security-log S3 bucket, and application security group.
3. `StorageStack`: retained, private, versioned, KMS-encrypted attachments bucket with access logging and lifecycle rules.
4. `ComputeFoundationStack`: ECR repository, ECS cluster, application log group, placeholder Secrets Manager secret, and ECS execution/runtime roles. It explicitly omits a task definition and service.
5. `ObservabilityStack`: multi-Region CloudTrail, GuardDuty, Security Hub CSPM, and AWS Config recorder/channel.

## AWS staging inventory

### Existing infrastructure

| Area | Observed state |
| --- | --- |
| Account identity | Account `265544358665`; TracePoint staging SSO assumed role |
| CloudFormation | No stacks |
| Tagged resources | TracePoint staging IAM Identity Center permission set; no tagged workload resources |
| VPC | One default VPC, `172.31.0.0/16` |
| Subnets | Six default public subnets, one in each `us-east-1a` through `us-east-1f`; public IPv4 mapping enabled |
| NAT gateways / VPC endpoints / flow logs | None |
| Security groups | Default security group only |
| Load balancers / target groups | None |
| ECR / ECS | No repositories, clusters, services represented by clusters, or task definitions; registry scanning is basic with no rules |
| S3 | No buckets |
| KMS | AWS-managed aliases only; no `alias/tracepoint/...` customer key |
| CloudWatch | No log groups or alarms |
| Secrets Manager | No secrets (metadata listing only; values were not requested) |
| IAM | Seven roles: two IAM Identity Center roles and five AWS service-linked roles; no TracePoint workload roles |
| CloudTrail | No trails |
| GuardDuty | No detector |
| Security Hub CSPM | Account is not subscribed |
| AWS Config | No recorder, delivery channel, or recorder status |
| RDS/Aurora / DynamoDB | No DB instances, DB clusters, or DynamoDB tables |
| Cognito | No user pools |
| SES / SNS / SQS / EventBridge | No identities, topics, queues, or rules |
| ACM / Route 53 / WAF / CloudFront | No certificates, hosted zones, regional web ACLs, or distributions |
| Lambda / API Gateway v2 | None |
| AWS Backup | No backup vaults |

### IAM and permission observations

- No AWS API returned `AccessDenied` during the inventory.
- The staging SSO role has the AWS-managed `AdministratorAccess` policy attached and an inline policy intended to scope work to TracePoint staging resources. An allow-only inline policy does not restrict permissions granted by `AdministratorAccess`; the role is therefore broader than its description suggests.
- The organization exposes only the AWS-managed `FullAWSAccess` service control policy, so no restrictive SCP was observed.
- The inline policy names CloudFormation stacks as lowercase `tracepoint-staging-*`, while current CDK stack IDs begin `TracePoint-staging-*`. It also scopes ECR to `tracepoint-staging-*`, while the current repository name is exactly `tracepoint-staging`. These patterns should be reconciled before replacing `AdministratorAccess` with an actually restricted permission set.
- The AWS MCP scripting adapter reported AWS Config as unsupported. The same read-only checks succeeded through the AWS CLI proxy and returned empty collections. This was a tooling limitation, not an IAM denial.
- Security Hub returned `InvalidAccessException` because the account is not subscribed. This is service state, not an IAM denial.

## Repository-to-account gap analysis

| Repository requirement or proposal | AWS state | Assessment |
| --- | --- | --- |
| Dedicated VPC with public, private-app, and isolated-data tiers | Default public VPC only | Missing |
| Controlled egress and private service access | No NAT gateway or VPC endpoints | Missing |
| VPC Flow Logs | None | Missing |
| Customer-managed KMS data key | AWS-managed aliases only | Missing |
| Security/audit log bucket | No S3 buckets | Missing |
| Attachments bucket | No S3 buckets; app still uses Supabase Storage | Missing in AWS and not integrated in app |
| Container registry | No ECR repository; no Dockerfile | Missing on both sides of deployment path |
| ECS cluster and application logs | No ECS or log groups | Missing |
| ECS runtime | CDK deliberately omits task definition/service/ALB | Missing |
| Application secret container | No Secrets Manager secrets | Missing; required keys and population workflow also need definition |
| Database | Supabase PostgreSQL only; no RDS/Aurora | AWS target missing; migration design pending |
| Authentication | Supabase Auth only; no Cognito | AWS target missing; migration design pending |
| Email dispatch | Direct Brevo calls; no SES/SQS/EventBridge | AWS-native path missing; retaining Brevo initially is viable |
| TLS/DNS/edge protection | No ACM, Route 53, ALB, CloudFront, or WAF | Missing; domain ownership and ingress design are required inputs |
| Audit/threat/configuration services | No trail, GuardDuty, Security Hub, or Config | Missing |
| Operational monitoring | No alarms/dashboards; CDK only defines a log group | Missing beyond log retention |
| Backup/restore | No AWS backup resources; Supabase recovery posture not represented in repo | Missing/unknown |
| CI/CD | No AWS deployment pipeline or OIDC role | Missing |

## Recommended migration sequence

1. **Correct and validate the foundation locally.** Align stack/resource naming with the staging permission model, add termination protection to stateful stacks, synthesize templates, review `cdk diff`, and define deployment checkpoints. Do not bootstrap or deploy during the read-only baseline.
2. **Deploy the AWS foundation in dependency order after approval.** Network, security, storage, compute foundation, then observability. Before enabling account-level services, recheck organization ownership of CloudTrail, GuardDuty, Security Hub, and Config to avoid duplicate or centrally managed configurations.
3. **Containerize without changing data or identity.** Build a Next.js standalone image, add a health endpoint, push an immutable image to ECR, and create an ECS Fargate service behind an ALB with TLS. Initially retain Supabase Auth, PostgreSQL, RLS/RPCs, Supabase Storage, and Brevo so hosting migration risk is isolated.
4. **Establish delivery and operations.** Add least-privilege CI/CD federation, rolling-deployment protections, autoscaling, health alarms, log/metric dashboards, synthetic checks, and rollback procedures. Use one identical build across ECS tasks; coordinate Next.js deployment IDs and server-action encryption when scaling beyond one task.
5. **Migrate object storage as a separate workstream.** Introduce a storage abstraction, dual-write or copy-and-verify attachments to S3, preserve metadata/checksums and authorization, test signed downloads and deletion/audit semantics, then stop Supabase Storage writes only after reconciliation. Include S3 request/storage/KMS/logging costs in the decision.
6. **Decide and migrate email delivery separately.** Either retain Brevo behind the existing adapter or move to SES. For SES, verify domain identity and production sending access, add queueing/retries/idempotency, and compare deliverability and operating responsibilities before switching.
7. **Choose the identity target.** Keeping Supabase Auth initially avoids coupling hosting cutover to identity migration. A Cognito migration requires decisions on password migration/reset, MFA, invitation/OTP behavior, claims, tenant/department context, and administrative workflows. Run parallel validation before any user cutover.
8. **Migrate PostgreSQL last among core dependencies.** Because this is an existing PostgreSQL/Supabase workload with extensive RLS, triggers/functions, and RPCs, Aurora PostgreSQL is the closest AWS-managed migration target. Inventory extensions and Supabase-specific functions, convert incompatibilities, establish schema/data replication, validate row counts and business workflows, and rehearse rollback. Do not combine the engine move with an authorization rewrite.
9. **Perform staging acceptance and recovery exercises.** Test every API route and workflow, file integrity, emails, audit logs, autoscaling, backup restore, failover behavior, and rollback using non-production data.
10. **Plan production and live-agency cutover only as a separate approved program.** Define RTO/RPO, maintenance window, data freeze/replication strategy, communications, rollback thresholds, and explicit go/no-go approval. This baseline does not authorize that cutover.

## Consequential decisions still required

- Staging/production domain names and whether ingress is ALB-only or CloudFront plus ALB.
- Whether Supabase remains a long-term managed dependency or is fully replaced.
- Cognito versus retained Supabase Auth, including user migration experience and MFA requirements.
- Aurora PostgreSQL topology/capacity, availability targets, RTO/RPO, and supported extension/function compatibility.
- Brevo retention versus SES migration.
- Attachment retention, Object Lock/legal-hold requirements, malware scanning, and cross-Region recovery.
- Deployment platform and CI/CD source, promotion, approval, and rollback model.
- Compliance boundary and required controls for public-safety-sensitive data.

## Inventory limitations

- The assessment is a point-in-time API inventory of account `265544358665` in `us-east-1`; global services were queried from the same session.
- Secret values, S3 object contents, CloudTrail event history, security findings, application data, Supabase project state, and production resources were intentionally not retrieved.
- Empty list responses demonstrate no visible resources for the caller at assessment time. No `AccessDenied` errors indicate the results were not known to be permission-truncated.
