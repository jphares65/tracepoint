# TracePoint staging cost and pre-deployment review

**Review date:** 2026-08-29
**Scope:** current uncommitted migration work and the synthesized CDK assembly for `tracepoint-staging` in `us-east-1`
**Target update (2026-08-30):** dedicated AWS Organizations member account; the inventoried management account is excluded
**Safety boundary:** this was a local and read-only review. No AWS resource was created, modified, deleted, bootstrapped, or deployed, and no secret value was retrieved.

## Executive recommendation

Do not deploy the synthesized six-stack assembly as-is. Its application shape is reasonable, but it combines application infrastructure with account-wide security services, pays for both a NAT gateway and eight interface-endpoint placements, creates an unused attachment bucket and security group, and would delete the application secret if its stack were ever deleted after termination protection was disabled.

For the first staging iteration, use the lean design described below: one public-IP Fargate task in a public subnet, still reachable only through an HTTPS ALB security group; no NAT gateway or paid interface endpoints; an S3 gateway endpoint; one task; narrowly retained logs; and account security services owned by a separate platform/security baseline. This reduces the modeled monthly cost from **$140.66** to **$42.07** while keeping the container inaccessible directly from the internet. If public task addressing is unacceptable, use private tasks with one NAT gateway but omit the interface endpoints, modeled at **$82.21/month**.

## Cost model and assumptions

The model was re-run deterministically on 2026-09-02 and remains **$42.07/month**
with **$32.93** headroom below the `$75` ceiling. No foundation resource was
added. Two standard CloudWatch alarms are added only with the currently
undeployed runtime and are covered by the existing `$2.90` security allowance.

These are planning estimates, not quotes. Prices were checked for `us-east-1` and calculations use 730 hours/month. Minimal realistic staging usage assumes one continuously running Linux/x86 Fargate task (0.25 vCPU, 0.5 GB), one ALB across two Availability Zones, 0.1 average LCU, 5 GB of NAT traffic, 1 GB of ECR storage, one secret, low log and object volume, 2,000 Config configuration items, 1,000 Security Hub checks, and light GuardDuty management/network analysis. Internet data transfer is assumed to remain within applicable allowances. Taxes, support, CI builds, vulnerability scanning, WAF, DNS registration, and third-party Supabase/Brevo charges are excluded.

Pricing references: [VPC](https://aws.amazon.com/vpc/pricing/), [Fargate](https://aws.amazon.com/ecs/pricing/), [Elastic Load Balancing](https://aws.amazon.com/elasticloadbalancing/pricing/), [public IPv4](https://aws.amazon.com/vpc/pricing/), [ECR](https://aws.amazon.com/ecr/pricing/), [KMS](https://aws.amazon.com/kms/pricing/), [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/), [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/), [S3](https://aws.amazon.com/s3/pricing/), [GuardDuty](https://aws.amazon.com/guardduty/pricing/), [Security Hub CSPM](https://aws.amazon.com/security-hub/cspm/pricing/), [Config](https://aws.amazon.com/config/pricing/), and [CloudTrail](https://aws.amazon.com/cloudtrail/pricing/).

### Current synthesized design

| Service / charge | Assumption | Monthly estimate |
|---|---:|---:|
| NAT Gateway | 730 gateway-hours | $32.85 |
| NAT public IPv4 | 1 address, 730 hours | $3.65 |
| NAT processing | 5 GB | $0.23 |
| Interface VPC endpoints | 4 services × 2 AZs × 730 hours | $58.40 |
| Interface endpoint processing | 5 GB | $0.05 |
| Application Load Balancer | 730 hours | $16.43 |
| ALB public IPv4 | 2 addresses × 730 hours | $7.30 |
| ALB capacity | 0.1 average LCU | $0.58 |
| ECS Fargate | 0.25 vCPU / 0.5 GB, 730 hours | $9.01 |
| ECR | 1 GB | $0.10 |
| KMS | 1 customer-managed key | $1.00 |
| Secrets Manager | 1 secret plus negligible calls | $0.40 |
| CloudWatch | low logs, metrics, and Container Insights allowance | $2.59 |
| S3 | 5 GB plus light requests | $0.17 |
| GuardDuty | light management and network analysis | $0.90 |
| Security Hub CSPM | 1,000 checks | $1.00 |
| AWS Config | 2,000 configuration items | $6.00 |
| CloudTrail, ACM, CloudFormation, ECS control plane, VPC, S3 gateway endpoint | no direct charge at modeled usage; storage/logging is above | $0.00 |
| **Estimated total** | | **$140.66/month** |

The largest avoidable charge is the interface-endpoint set. Because the task also has a NAT path for public Supabase and Brevo calls, the endpoints add **$58.45/month** at this scale without eliminating NAT. A private-task design that keeps one NAT gateway but drops these endpoints is approximately **$82.21/month**.

KMS rotation can increase the key's monthly storage charge after rotations. GuardDuty, Security Hub, Config, CloudWatch, and data transfer are usage-sensitive; their first real invoice should be compared with tagged resources and Cost Explorer before revising this budget.

## Lean staging alternative

The recommended lean topology is:

- Keep the internet-facing ALB across two public subnets, HTTPS-only with HTTP redirect.
- Run one Fargate task in a public subnet with a public IPv4 address, but allow inbound traffic only from the ALB security group. The task exposes no public listener, SSH, or host access. Restrict egress where the external dependency destinations permit it.
- Remove the NAT gateway and the paid Secrets Manager, ECR API, ECR Docker, and CloudWatch Logs interface endpoints. Keep the free S3 gateway endpoint. Fargate uses its public egress only for image bootstrap, AWS APIs, Supabase, and Brevo.
- Disable Container Insights initially; retain application logs for a short staging period and add only actionable alarms.
- Defer the attachment S3 bucket until application code actually migrates from Supabase Storage.
- Remove the unused application security group and let the runtime stack own its ALB-to-task relationship.
- Keep CloudTrail, GuardDuty, Security Hub, and Config under the separate account baseline described below. Use selective Config recording rather than application-owned `allSupported` recording.

| Lean-design charge | Monthly estimate |
|---|---:|
| ALB, two ALB public IPv4s, and 0.1 LCU | $24.31 |
| Fargate task and one task public IPv4 | $12.66 |
| ECR, KMS, and one secret | $1.50 |
| CloudWatch and S3 | $0.70 |
| GuardDuty, Security Hub, and selective Config allowance | $2.90 |
| **Estimated total** | **$42.07/month** |

The tradeoff is that the task has an internet-routable address even though its security group rejects unsolicited inbound traffic. The private-NAT alternative is preferable where policy forbids public addressing, but one NAT gateway is a single-AZ dependency and can create cross-AZ processing. A production topology should revisit multi-AZ tasks, NAT resilience, autoscaling, WAF, and endpoint economics.

## ALB-only versus CloudFront plus ALB

| Consideration | ALB only | CloudFront + ALB |
|---|---|---|
| Minimal staging cost | ALB charges apply | ALB remains; low CloudFront use may fit its free tier |
| Complexity | One TLS and routing layer | Additional distribution, cache policy, certificates, headers, logging, and deployment surface |
| Dynamic Next.js behavior | Direct and predictable | Cookies, authorization, server actions, and dynamic routes require deliberate no-cache and forwarding policies |
| Performance | Regional ingress | Edge TLS, HTTP/3, and cache acceleration where content is cacheable |
| Origin protection | ALB security group/WAF/IP controls | Must explicitly restrict ALB access, for example with the CloudFront managed prefix list plus an origin-secret validation control; otherwise clients can bypass CloudFront |
| Security controls | AWS Shield Standard; optional regional WAF | AWS Shield Standard; optional edge WAF and centralized edge policy |
| Operational debugging | Fewer hops | More powerful edge controls but more places for cache and header faults |

**Recommendation:** start staging with ALB-only. CloudFront itself need not add a fixed monthly charge at this volume, but its operational complexity is not justified until edge caching, edge WAF, global latency, or origin concealment is a defined requirement. If selected later, keep authenticated and server-action traffic uncached and make bypass prevention part of the same change.

## Repository and synthesized-architecture review

### Safe and intentional changes

- The Docker image is multi-stage, uses Next.js standalone output, and runs as a non-root user.
- The health endpoint is unauthenticated but returns no sensitive data.
- ECR tags are immutable, application buckets and keys use retention policies, and all stacks have termination protection in the assembly.
- The runtime is opt-in and fails closed without an ACM certificate ARN and immutable image tag.
- The ALB redirects HTTP to HTTPS; the ECS service uses health checks and deployment rollback.
- `cdk.out`, infrastructure build output, and infrastructure dependencies are ignored. No generated JavaScript or declaration files are present beside the TypeScript sources. `package-lock.json` is an intentional reproducibility artifact.

### Deployment blockers and corrections required

1. **Secret deletion behavior:** the synthesized Secrets Manager secret has a `Delete` deletion policy. Termination protection does not protect against every update/replacement and can itself be disabled. Change the secret to retain before deployment.
2. **Server Action encryption key timing:** `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is currently injected only as an ECS runtime secret, but Next.js uses it during build for consistent Server Action encryption across instances/builds. It must be supplied securely at image build time and consistently at runtime where required. Do not use an ordinary Docker `ARG` that can expose it in image metadata; use an approved CI secret/BuildKit secret workflow.
3. **Account-wide services in the application assembly:** CloudTrail, GuardDuty, Security Hub, and Config are singleton/organization concerns. Deploying them from an application lifecycle risks conflicts, duplicate charges, and ownership ambiguity. Remove or gate the observability stack from the app deployment set until platform ownership is approved.
4. **Redundant network cost:** NAT plus eight interface-endpoint placements is not economical for low-volume staging. Select either the lean public-task topology or the private-NAT topology without these endpoints.
5. **Unused resources:** the attachment bucket is not used while Supabase Storage remains active, and the security stack's application security group is not attached to the runtime. Defer/remove both from the first deployment.
6. **Naming and permissions:** synthesized stack IDs use `TracePoint-staging-*` while the previously intended restricted deployment policy pattern is lower-case `tracepoint-staging-*`. Current administrator access masks this conflict. Align names and define a least-privilege deployment role before deployment.
7. **Availability:** one desired task is intentionally low-cost but provides no task redundancy. The ALB is multi-AZ; the task and single NAT design are not. This is acceptable only if staging downtime is explicitly accepted.
8. **Observability gaps:** the runtime has no WAF, application alarms, dashboard, synthetics, or autoscaling. These are not all required for lean staging, but at least actionable 5xx/target-health alarms should precede wider external use.

### Conflicts and non-migration changes

- `src/app/integration-demo/` is untracked existing TracePoint work unrelated to this migration. It must remain excluded from any migration commit unless its owner explicitly includes it.
- Removing `next/font/google` avoids build-time network dependency but changes the rendered typography to system fallbacks. Product/design acceptance is required before shipping that visual change.
- `NEXT_PUBLIC_*` values are embedded during image build, not supplied by the ECS secret. The build pipeline needs explicit staging public configuration and must not accidentally reuse production values.
- The first hosting phase continues to depend on Supabase for PostgreSQL, authentication, and object storage, and on Brevo for email. The AWS attachment bucket does not migrate those functions.
- Termination protection and `Retain` policies reduce deletion risk but do not make `cdk deploy` non-destructive. Every deployment still requires review of `cdk diff`, replacements, IAM expansion, and named-resource collisions.

## Domain and certificate recommendation

Use **`staging.tracepointhq.com`**, subject to confirmation that TracePoint controls `tracepointhq.com`. Create an exact-name public ACM certificate in `us-east-1` with DNS validation; avoid a wildcard unless another approved staging service needs it. Keep the hosted zone and certificate under a platform/DNS owner, while the application stack consumes the certificate ARN and creates only its approved alias record. If the zone already exists in Route 53, the alias has no incremental DNS-query charge; a new hosted zone is generally $0.50/month. See [Route 53 pricing](https://aws.amazon.com/route53/pricing/) and [CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/).

For ALB-only, the certificate attaches to the ALB in `us-east-1`. CloudFront also requires its viewer certificate in `us-east-1`; because this deployment is in that region, an appropriately scoped certificate can be reused, though separate lifecycle ownership may be cleaner.

## Secrets Manager workflow

Use `tracepoint/staging/application` as one JSON secret initially because the single ECS task consumes all current confidential values. Split secrets later when consumers, owners, or rotation schedules diverge. The workflow should be:

1. Platform creates the empty retained secret and exact-resource policies; no value enters CDK context, source control, logs, shell history, or documentation.
2. An authorized human or CI identity writes the complete JSON atomically through an approved concealed-input workflow. Validate only metadata and required key names, never values.
3. The ECS execution role receives `secretsmanager:GetSecretValue` only for this secret and tightly scoped KMS decrypt permission. The application task role receives no secret-read permission because ECS injects the values. A separate migration/operator role owns writes.
4. Rotate with staged versions (`AWSPENDING` then `AWSCURRENT`), validate the dependency, and force a controlled task replacement because environment-injected secrets are read only at task start.
5. Keep non-secret `NEXT_PUBLIC_*` values in the build environment. Provide the Server Action key through a protected build-secret mechanism, not a Docker argument, and keep it consistent for all tasks participating in the same deployment.

## Security-service ownership model

The staging account is currently the AWS Organizations management account, making application ownership especially inappropriate for account-wide controls.

| Service | Recommended owner and lifecycle |
|---|---|
| CloudTrail | Platform/security baseline: one organization multi-region trail with log validation and a centrally protected log-archive bucket. The app may request specific data-event selectors, but does not own the trail. Prefer S3 as the baseline destination; add CloudWatch delivery only for defined near-real-time detections. |
| GuardDuty | Security team through an Organizations delegated administrator and centrally managed auto-enable policy. The application consumes findings; it does not create/delete the detector. |
| Security Hub | Security team through delegated administration and regional aggregation, with centrally selected standards. The application remediates assigned findings but does not own the hub. |
| AWS Config | Platform/security baseline: per-account/per-region recorder and delivery channel, with an organization aggregator. Record the resource types required by approved controls rather than application-owned `allSupported` recording where cost and policy permit. |

Until dedicated security tooling and log-archive accounts exist, a platform/security owner should manage these in a separate baseline stack in the staging management account. Their lifecycle must remain independent of TracePoint application stacks.

## Decisions adopted on 2026-08-30

1. Use the **lean public-IP task ($42.07/month modeled)** with ALB-only task ingress.
2. Use **ALB-only initially**; defer CloudFront.
3. Use **`staging.tracepointhq.com`** with an exact-name DNS-validated ACM certificate in `us-east-1`.
4. Assign CloudTrail, GuardDuty, Security Hub, and Config to a **separate platform/security baseline**.
5. Retain one application secret and mount the Server Action key as a protected BuildKit build secret.
6. Defer the attachment bucket and remove the unused security group.
7. Use one task. Preserve Geist typography through local self-hosted font assets rather than accepting system fallbacks.
8. Use lowercase naming and separate least-privilege image-builder/deployer roles.
9. Deploy only to a dedicated Organizations member account, never the current management account.

The local revision implementing these decisions is reviewed in
`docs/aws-cdk-diff-review.md`. No bootstrap, deployment, DNS change, certificate
request, secret population, or AWS mutation is authorized.
