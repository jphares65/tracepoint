# TracePoint staging CDK local diff review

**Review date:** 2026-08-30
**Target:** dedicated staging account `559054714699`, `us-east-1`
**Comparison:** prior six-stack local assembly versus revised four-stack local assembly
**AWS activity:** none. This is a synthesized-template comparison, not a live CloudFormation change-set diff.

## Result

The revised assembly synthesizes locally for verified staging account
`559054714699` with a placeholder certificate ARN. It refuses management account
`265544358665`, every other account, and every environment other than
`tracepoint-staging`. The account has no CloudFormation stacks and no
`CDKToolkit`, so an authoritative live CDK diff remains blocked until a
separately approved least-privilege bootstrap.

## Assembly change

| Area | Prior assembly | Revised assembly |
|---|---:|---:|
| Stacks | 6 | 4 |
| VPC subnets | 6 | 2 public |
| NAT gateways / EIPs | 1 / 1 | 0 / 0 |
| VPC endpoints | 5 (4 interface, 1 gateway) | 1 S3 gateway |
| Security groups | 7 | 2 (ALB and task) |
| S3 buckets | 2 | 0 |
| CloudTrail / GuardDuty / Security Hub / Config resources | 4 account-control resources plus Config role/channel | 0 |
| ECS tasks | 1 private-addressed | 1 public-IP task |
| Container Insights | enabled | disabled |
| Application log retention | 365 days | 30 days |
| Application secret deletion policy | delete | retain/update-replace retain |

Removed stacks are `TracePoint-staging-Observability` and
`TracePoint-staging-Storage`. Remaining stacks are standardized as:

- `tracepoint-staging-network`
- `tracepoint-staging-security`
- `tracepoint-staging-compute`
- `tracepoint-staging-runtime`

This is safe for the proposed member account because no prior TracePoint stacks
will exist there. These names must never be used to update the older local
management-account proposal: changing construct/stack IDs against deployed
resources could cause replacements or retained orphans.

## Revised resource review

The templates contain one VPC, two public subnets in separate AZs, an internet
gateway, flow log and log group, a free S3 gateway endpoint, restricted-default-
security-group custom resource, one KMS key/alias, one ECR repository, one ECS
cluster, one retained application log group, one retained secret, ECS execution
and task roles, one ALB, HTTPS and HTTP-redirect listeners, one target group,
one task definition, and one desired Fargate service.

Verified properties:

- ECS `AssignPublicIp` is `ENABLED` and desired count is exactly one.
- The task security group has one inbound rule: TCP 3000 from the ALB security
  group. It has no CIDR-based inbound rule.
- The ALB uses the supplied ACM certificate on 443 and redirects port 80 to 443.
- No NAT gateway, interface endpoint, S3 bucket, CloudTrail, GuardDuty, Security
  Hub, or Config resource is present.
- Container Insights is disabled.
- The secret and application log group both synthesize with `Retain` deletion
  and update-replacement policies.
- Named stacks, ECR repository, ECS cluster/service, IAM roles, KMS alias, log
  group, and secret use lowercase TracePoint environment naming.
- All four stacks retain termination protection.

## Security and deployment observations

- Public addressing does not create a direct application listener. The task is
  reachable only from the ALB security group, satisfying the approved lean
  topology. The task still has unrestricted outbound access for ECR bootstrap,
  Supabase, Brevo, Secrets Manager, and Logs; destination-level egress controls
  can be revisited when stable provider address ranges/endpoints exist.
- Flow Logs remain enabled as a lean security control. Their CloudWatch usage is
  variable and should be monitored after launch.
- The application task role has no application AWS permissions. ECS secret and
  image access stay on the execution role.
- The ECS execution role uses AWS's standard execution managed policy plus exact
  secret and KMS resources. The future deployment and image-builder roles are
  account prerequisites documented in `infra/README.md`; they are deliberately
  not self-created by the application assembly.
- The exact ACM certificate and `staging.tracepointhq.com` alias are inputs, not
  resources in this assembly.
- The KMS key, ECR repository, application log group and application secret have
  `Retain` deletion/update-replacement intent. The deferred attachment bucket is
  not in the assembly and is also coded `Retain` if introduced later.
- Management account `265544358665` and every environment other than literal
  `staging` fail before synthesis. Runtime additionally rejects cross-account/
  cross-region certificate ARNs and `latest`/invalid image tags.
- `cdk.out*`, `dist` and infrastructure `node_modules` are ignored generated
  artifacts and are excluded by the migration-only manifest.

## Application-build delta

- Geist and Geist Mono Latin variable-font files are now source-controlled local
  assets loaded with `next/font/local`; builds no longer contact Google and the
  original typography/CSS variables are preserved.
- Docker uses a required BuildKit secret mount for
  `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`. It is not a Docker build argument or
  persisted environment layer. ECS injects the same secret JSON field at runtime.
- The Next.js production build passes with a non-secret local test key.

## Remaining real diff gate

Before any deployment, the platform owner must:

1. use account `559054714699`, verify account-specific context, supply the certificate ARN,
   immutable image tag, bootstrap qualifier, and permissions-boundary ARN;
2. perform separately approved least-privilege CDK bootstrap work;
3. synthesize again and inspect all templates for placeholder or management-
   account references;
4. run `cdk diff --no-change-set` first, then a change-set-backed diff if
   authorized, and confirm the result contains additions only;
5. stop for deployment approval if any replacement, deletion, IAM broadening,
   DNS/certificate action, or platform-security resource appears.
