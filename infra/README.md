# TracePoint staging infrastructure

This CDK application targets dedicated staging account `559054714699` in
`us-east-1`. It refuses every other account and environment, with a separate
explicit refusal for management account `265544358665`. It never creates an AWS
account, certificate, or DNS record.

## Application assembly

The five lowercase stacks are:

- `tracepoint-staging-network`: two public subnets across two AZs, internet
  gateway, VPC Flow Logs, restricted default security group, and the no-charge
  S3 gateway endpoint. There is no NAT gateway or paid interface endpoint.
- `tracepoint-staging-security`: one retained, rotating KMS key.
- `tracepoint-staging-compute`: immutable ECR repository, ECS cluster without
  Container Insights, 30-day retained logs, retained application secret, and
  separate ECS execution/task roles.
- `tracepoint-staging-image-build`: retained KMS-encrypted, versioned clean-source
  bucket; KMS-encrypted 30-day build logs; and a least-privilege CodeBuild project
  that can read the staging application secret and push only to staging ECR.
- `tracepoint-staging-runtime` (opt-in): one public-IP Fargate task behind an
  HTTPS ALB. Its security group accepts port 3000 only from the ALB security
  group; the ALB redirects HTTP to HTTPS. It also creates ALB 5xx-rate and
  unhealthy-target alarms with explicit missing-data behavior.

All stacks carry `Application`, `Environment`, `Owner`, `ManagedBy`,
`CostCenter`, and `DataClassification` tags. The ECS execution role is limited to
the staging repository, application log group, application secret, and data key;
only ECR authorization-token retrieval uses an unavoidable wildcard resource.
The application task role has no permissions.

The unused attachment bucket is deferred. CloudTrail, GuardDuty, Security Hub,
and Config are excluded: they belong to a separate, organization-aware
platform/security baseline with independent lifecycle ownership.

## Local synthesis

All three target values are explicit and fixed:

```powershell
npx.cmd cdk synth --output cdk.out.revised `
  -c account=559054714699 `
  -c region=us-east-1 `
  -c environment=tracepoint-staging `
  -c runtimeEnabled=true `
  -c certificateArn=arn:aws:acm:us-east-1:559054714699:certificate/REPLACE_ME `
  -c imageTag=REPLACE_WITH_IMMUTABLE_TAG `
  --lookups=false
```

The certificate and image tag remain placeholders until separately approved
platform and publishing work. The runtime consumes an existing
exact-name ACM certificate for `staging.tracepointhq.com`; certificate request,
DNS validation, and the Route 53 alias remain separate platform actions.

## Protected build secret

`NEXT_PUBLIC_*` and `DEPLOYMENT_VERSION` are public build arguments. The Server
Action key is mounted only for `next build` through Docker BuildKit:

```powershell
$env:NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = "RETRIEVE_WITHOUT_PRINTING"
docker build `
  --secret id=next_server_actions_encryption_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY `
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://REPLACE_ME.supabase.co `
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=REPLACE_ME `
  --build-arg NEXT_PUBLIC_SITE_URL=https://staging.tracepointhq.com `
  --build-arg DEPLOYMENT_VERSION=REPLACE_WITH_COMMIT_SHA `
  -t tracepoint-staging:REPLACE_WITH_COMMIT_SHA ..
```

The build identity reads the retained staging secret because CodeBuild must inject
the three public build values and `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`. It must not
print values or store the Server Action key in the workspace or a Docker `ARG`.
ECS injects the same key at task startup, so rotation requires a new immutable
image and task replacement.

The retained JSON secret also supplies `SUPABASE_SECRET_KEY`, `BREVO_API_KEY`,
and `NOTIFICATION_DISPATCH_SECRET`. Populate all keys atomically through an
approved concealed-input workflow; CDK contains no real values.

Image publication validates only the five build-time fields. The remaining
three runtime-only fields stay mandatory for an ECS launch, but their absence
does not prevent producing and scanning an otherwise deployable image.

## Least-privilege deployment design

The member-account platform administrator—not this application assembly—creates:

1. The deployed CodeBuild image role: push only to the staging ECR repository,
   read only the staging application secret, and decrypt only through Secrets
   Manager. It cannot deploy or pass roles.
2. `tracepoint-staging-deployer`: assume only dedicated CDK bootstrap deploy,
   asset-publishing, and lookup roles. `iam:PassRole` is limited to the bootstrap
   CloudFormation execution role with
   `iam:PassedToService=cloudformation.amazonaws.com`.

Bootstrap needs a dedicated qualifier, an approved permissions boundary, and a
customer-managed CloudFormation execution policy limited to the synthesized
VPC/EC2 networking, ELBv2, ECS, ECR, Logs, KMS, Secrets Manager, prefixed IAM
roles, and CDK asset resources. Explicitly exclude Organizations, account
management, DNS/certificate changes, account security services, billing, and
production. Exact role ARNs, trust principal, boundary ARN, organization ID,
qualifier, and member account ID remain account-creation inputs. Review AWS CDK
[bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html)
and [permissions-boundary](https://docs.aws.amazon.com/cdk/v2/guide/customize-permissions-boundaries.html)
guidance before a separate bootstrap approval.

## Gate

Use existing dependencies only. Before any deployment, build/scan the immutable
image, synthesize with the real account and certificate, and review a real
`cdk diff`. Database, identity, Supabase/Brevo migration, CloudFront, WAF,
multi-task capacity, production, and live-agency cutover remain deferred.

Run `npm test` in `infra/` to verify lean-network, encryption, retention, ECR,
IAM, disabled-runtime, provider-pin, task-size, TLS-listener, rollback, and alarm
invariants. `scripts/get-tracepoint-staging-inventory.ps1` performs the matching
metadata-only account inventory after verifying the staging identity.

The manual `.github/workflows/aws-staging-foundation.yml` workflow validates and
deploys only the three foundation stacks with runtime disabled. It requires the
protected `aws-staging` GitHub environment and an OIDC role ARN in the
`AWS_STAGING_DEPLOY_ROLE_ARN` repository variable.
