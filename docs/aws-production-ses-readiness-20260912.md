# Production SES readiness checkpoint — 2026-09-12

This checkpoint is preparation only. It does not authorize creating an SES
identity, submitting the production-access request, changing DNS, creating a
subscription, or sending email.

## Read-only live state

- AWS account: `193644343389`; region: `us-east-1`; role:
  `TracePointMigrationProduction`.
- SES production access: disabled. Sending is enabled only under the sandbox
  limits of 200 messages per 24 hours and one message per second. Zero messages
  were sent in the preceding 24 hours when checked.
- SES identities: none. Consequently, production Easy DKIM tokens do not exist
  yet and cannot truthfully be placed in DNS now.
- Account suppression is already enabled for both `BOUNCE` and `COMPLAINT`.
- Current SES plan: Essentials.
- Authoritative DNS is Wix (`ns10.wixdns.net`, `ns11.wixdns.net`). The custom
  MAIL FROM name has no MX or TXT record. The root domain's Microsoft 365 SPF
  record remains separate. Current DMARC sends aggregate reports to Brevo and
  must be replaced to remove that operational dependency.

## Exact target identity and configuration

| Item | Exact target |
|---|---|
| Verified domain | `tracepointhq.com` |
| Application From | `notifications@tracepointhq.com` |
| Custom MAIL FROM | `bounce.tracepointhq.com` |
| Transactional configuration set | `tracepoint-production` |
| Cognito configuration set | `tracepoint-production-cognito` |
| TLS policy | `REQUIRE` on both configuration sets |
| Suppression | `BOUNCE` and `COMPLAINT` at account and both configuration sets |
| Event publishing | `DELIVERY`, `BOUNCE`, and `COMPLAINT` from both configuration sets to the encrypted production feedback SNS topic and retained SQS/DLQ |
| MAIL FROM failure behavior | `REJECT_MESSAGE` |
| DKIM | Easy DKIM, RSA 2048, three SES-generated CNAMEs |

The production code previously published feedback events only for application
mail. This checkpoint corrects that defect: after deployment, Cognito activation
and recovery mail will publish the same delivery, bounce, and complaint events
to the durable feedback path. The worker accepts otherwise-unregistered Cognito
feedback only when the signed SES event carries the exact Cognito configuration
set; it then updates global suppression without inventing tenant attribution.
Both configuration-set ARNs are in the KMS grant, SNS certificate retrieval uses
PrivateLink, legacy feedback forwarding is disabled, and worker/database/backup
failures feed the central operational alert path.

## Exact DNS change set

Do not publish this set until the SES identity exists and all three DKIM tokens
have been copied from the same production account and region.

| Name | Type | TTL | Value | Status |
|---|---|---:|---|---|
| `bounce.tracepointhq.com.` | MX | 300 | `10 feedback-smtp.us-east-1.amazonses.com` | Exact and ready |
| `bounce.tracepointhq.com.` | TXT | 300 | `v=spf1 include:amazonses.com ~all` | Exact and ready |
| `_dmarc.tracepointhq.com.` | TXT | 300 | `v=DMARC1; p=none;` | Exact replacement for the Brevo-reporting record; owner DNS approval required |
| `<token-1>._domainkey.tracepointhq.com.` | CNAME | 300 | `<token-1>.<SigningHostedZone>` | Token unavailable until identity creation |
| `<token-2>._domainkey.tracepointhq.com.` | CNAME | 300 | `<token-2>.<SigningHostedZone>` | Token unavailable until identity creation |
| `<token-3>._domainkey.tracepointhq.com.` | CNAME | 300 | `<token-3>.<SigningHostedZone>` | Token unavailable until identity creation |

The existing root SPF record
`v=spf1 include:spf.protection.outlook.com -all` remains unchanged. SES aligns
SPF through the custom MAIL FROM subdomain; adding SES to the root SPF record is
not required.

After the owner-authorized SES stack creates the identity, obtain the only valid
DKIM values with this read-only command:

```powershell
aws sesv2 get-email-identity `
  --profile tracepoint-production `
  --region us-east-1 `
  --email-identity tracepointhq.com `
  --query 'DkimAttributes.{Status:Status,Tokens:Tokens,SigningHostedZone:SigningHostedZone}' `
  --output json
```

For every returned token, the record is exactly
`<token>._domainkey.tracepointhq.com CNAME <token>.<SigningHostedZone>`. The
returned `SigningHostedZone` must be used; it must not be hardcoded.

## Prepared production-access request

The complete request payload is in
`aws-production-ses-access-request-20260912.json`. Its additional contact is
`contact@tracepointhq.com`, because that address already appears in the reviewed
production configuration. The owner must confirm that this mailbox is monitored
before submission; this checkpoint does not claim delivery to it.

Prepared command — **do not execute without explicit authorization**:

```powershell
aws sesv2 put-account-details `
  --profile tracepoint-production `
  --region us-east-1 `
  --cli-input-json file://docs/aws-production-ses-access-request-20260912.json
```

## Production-access request narrative

TracePoint will send transactional, one-to-one messages to existing public-safety
department users: account activation, password recovery, security/session
notices, invitations, and operational workflow notifications. It will send no
marketing, cold outreach, purchased lists, or third-party lists. Department
administrators create recipients under an existing customer relationship.
Initial scope is 96 identities and expected volume is below 10,000 messages per
month. The sender will use a verified domain, Easy DKIM, a custom MAIL FROM domain,
TLS-required configuration sets, and account/configuration suppression for hard
bounces and complaints. Both application and Cognito configuration sets publish
delivery, bounce, and complaint events to encrypted SNS/SQS. An idempotent
worker persists suppression in PostgreSQL; suppressed recipients are not
retried. DLQ age, worker errors/throttles, runtime health, and SES reputation
metrics are monitored. Notification preferences are honored where applicable.

## Go/no-go requirements

Email activation remains no-go until all are true: owner authorizes the SES
identity and DNS changes; the three returned DKIM CNAMEs resolve; domain,
DKIM, and custom MAIL FROM statuses are successful; production access is
approved; `get-account` proves `ProductionAccessEnabled=true`,
`SendingEnabled=true`, `Max24HourSend >= 1000`, and `MaxSendRate >= 5`;
`contact@tracepointhq.com` is confirmed monitored or replaced with an approved
contact; both configuration sets show TLS and suppression settings;
both event destinations reach SQS; the feedback worker persists a simulator
bounce/complaint without exposing an address; the on-call alert path is
confirmed; and an approved non-customer recipient receives one transactional
smoke message. Before the first cohort, the application suppression table and
any provider-side source blocklist must be imported and reconciled by aggregate
count/hash. The preflight must also confirm account-level suppression remains
exactly `BOUNCE` plus `COMPLAINT`; suppressed recipients must be excluded from
identity and notification cohorts.

References: [custom MAIL FROM](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html),
[Easy DKIM records](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim-easy-managing.html),
[production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html),
[account suppression](https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html).
