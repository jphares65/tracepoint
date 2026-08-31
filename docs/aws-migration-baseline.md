# TracePoint AWS migration baseline

**Evidence time:** 2026-08-30 18:53:41-19:09:09 UTC
**AWS account:** dedicated staging account `559054714699`
**Region:** `us-east-1`
**Identity:** `arn:aws:sts::559054714699:assumed-role/AWSReservedSSO_TracePointMigrationStaging_52cda9da92884a87/jason.phares`
**Hard deny:** management account `265544358665`

## Scope and safety

AWS MCP ran STS plus metadata-only list/describe/get calls. No resource was
created, updated, deleted, bootstrapped, or deployed. The inventory did not read
secret values, credentials, S3 objects, application logs, DNS records, database
records, or Supabase data.

STS `GetCallerIdentity`, explicitly requested through `us-east-1`, returned
account `559054714699`; only then did inventory calls run. Global-service calls
used the same staging session. The MCP runner's ten-service limit required one
follow-up query for ACM and Identity Center metadata.

## Verified inventory

| Area | Read-only evidence |
|---|---|
| CloudFormation / CDK | zero stacks; no `CDKToolkit` bootstrap stack |
| VPC | default VPC `vpc-0c04a9ca579fc1441`, `172.31.0.0/16`, available |
| Subnets | six default public subnets across `us-east-1a`-`us-east-1f`; public IPv4 mapping enabled |
| Routes / internet | one main route table with local route and `0.0.0.0/0` to default IGW `igw-0ec9d0d43d8e633b4` |
| NAT / endpoints | zero NAT gateways; zero VPC endpoints |
| Security groups | default SG `sg-0652842de489a6c4e` only; self-reference ingress and all-IPv4 egress |
| ECS | zero clusters, services, and tasks |
| ECR | zero repositories and images |
| Load balancing | zero application/network load balancers and target groups |
| S3 | zero buckets; account-level public-access-block configuration is absent (`NoSuchPublicAccessBlockConfiguration`) |
| KMS | zero customer-created keys; 12 AWS service aliases only |
| Secrets Manager | zero secret metadata entries |
| CloudWatch Logs | zero log groups |
| Route 53 | zero hosted zones; record sets were not queried |
| ACM | zero certificates in `us-east-1` |

The account is clean for TracePoint: no pre-existing TracePoint workload or CDK
bootstrap resources were visible. The default VPC/network objects are AWS
defaults, not a migration foundation. The absent account S3 public-access block
is a platform prerequisite to resolve before any approved S3 use.

## IAM evidence and limitation

The session role name confirms use of `TracePointMigrationStaging`. User-supplied
read-only CLI output confirms permission set `ps-f17d74409ce29842` has AWS managed
`AdministratorAccess` attached alongside an inline staging policy. An allow-only
inline policy cannot reduce that grant. AWS MCP could list the Identity Center
instance but was denied `sso:ListPermissionSets`; the attachment confirmation
therefore comes from the user's `tracepoint-staging` CLI profile, not management
account access. A management-account Identity Center administrator must later
remove it using the lockout-safe sequence in `docs/aws-iam-access-transition.md`.

## Repository reconciliation

The committed CDK application is an undeployed four-stack staging design. It now
requires context environment `tracepoint-staging`, account `559054714699`, and
region `us-east-1`, and separately refuses management account `265544358665`.
`infra/cdk.context.json` remains `{}`: no lookups, secrets, or generated context.

The application remains authoritative on Supabase for database, RLS/RPC
authorization, authentication, and storage. Brevo remains the sole/default email
provider behind a local typed boundary. No AWS provider is implemented or active.

## Evidence limitations

Empty results prove no resources visible to this caller at the evidence time.
ACM completed successfully. AWS MCP permission-set enumeration was
permission-truncated, with the attached managed policy independently confirmed
by user-supplied read-only CLI output. The requested inventory intentionally excludes
CloudTrail event history, findings, alarms, IAM role enumeration, object/data
contents, DNS records, and secret values.
