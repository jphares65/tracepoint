# GovCloud portability boundary

TracePoint is **not GovCloud-ready**. This review does not authorize any account
or region beyond staging 559054714699/us-east-1, and changes no deployment gates.

## Verified service differences

Cognito is available in both GovCloud regions. Its API and hosted-login endpoints
use FIPS variants; custom user-pool domains are unavailable. Pool metadata needs
careful handling. Our hosted-domain, pool-ID and issuer handling therefore cannot
be ported merely by replacing a region variable.
[AWS Cognito GovCloud guide](https://docs.aws.amazon.com/govcloud-us/latest/UserGuide/govcloud-cog.html).

SES is available in both GovCloud regions, but email receiving is unsupported.
TracePoint's planned transactional sending does not require inbound SES email.
Sender verification, delivery and suppression must still be validated in the
destination account.
[AWS SES GovCloud guide](https://docs.aws.amazon.com/govcloud-us/latest/UserGuide/govcloud-ses.html).

SNS is available in both regions. Its GovCloud guide excludes several commercial
features, including message archiving/replay and message data protection. Our
feedback plan uses an encrypted SQS queue and database idempotency rather than
those features. Notification endpoints and metadata have additional restrictions;
do not assume commercial notification destinations are an approved GovCloud path.
[AWS SNS GovCloud guide](https://docs.aws.amazon.com/govcloud-us/latest/UserGuide/govcloud-sns.html).

## Concrete code boundaries remaining

| Area | Current implementation | Required destination work |
|---|---|---|
| Deployment authority | `infra/lib/production-target.ts` uses commercial ARN forms and us-east-1 | Separate positive account/partition/role gate, with independently authorized GovCloud credentials |
| Stack assembly | `infra/lib/production-assembly.ts` uses commercial us-east-1 availability zones | Destination-specific assembly, strict synth and structural review |
| Authentication | Cognito verifier, PKCE, transport and PostgreSQL session stores constrain issuer/pool/host formats to us-east-1 | FIPS endpoint/domain selection and signed issuer fixtures, durable mapping/session/refresh compatibility |
| Storage | S3 provider core constrains region to us-east-1 | Partition-aware target validation, private delivery and tenant-negative live acceptance |
| Email | SES foundation and sender configuration use commercial-region settings | Destination identity/configuration set, suppression/feedback worker and real delivery proof |
| Data | Supabase remains the active database/auth provider | Authorized PostgreSQL and authentication conversion, RLS equivalence, reconciliation and restore proof |
| CI/CD | Current OIDC trust/release gates target commercial staging | Separately scoped identity trust, artifact publication and deployment roles; no automatic trust reuse |

The provider boundaries, standard PostgreSQL migrations and reconciliation tools
are useful foundations. They are not evidence that the destination is deployed,
compliant or ready for customer data. Supabase database/auth and Brevo remain
external dependencies; production also retains Supabase storage.

## Implemented correction in this checkpoint

SNS feedback construction and signed-envelope verification now share one parser
that rejects partition/region mismatches, China endpoints outside the supported
partitions, malformed topic names and the prohibited management account. This
closes a configuration-validation gap without widening AWS deployment authority.
Ten focused topic/signature/batch tests pass, including signed-message tampering,
certificate URL/size constraints and rejection before network access.

No GovCloud AWS calls, infrastructure changes or provider activation occurred.
Weighted migration readiness remains **66.50%**.
