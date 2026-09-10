# TracePoint staging SES and DNS readiness — 2026-09-10

## Decision

**Not ready for SES delivery.** AWS account `559054714699` remains in the
Amazon SES sandbox in `us-east-1`. Its only SES identity,
`staging.tracepointhq.com`, is disabled for sending and has failed identity
verification, Easy DKIM, and custom MAIL FROM. The failure is not ambiguous:
every SES authentication name expected by the current identity returns NXDOMAIN
from both a public recursive resolver and the authoritative Wix name server.

The SES configuration set and encrypted SNS/SQS feedback transport exist, but
there is no queue consumer. Account- and configuration-set-level suppression
are enabled for bounces and complaints. Production access has never been
requested in this Region.

This was a read-only review. No DNS record, SES identity, configuration set,
suppression entry, SNS/SQS resource, email, production-access request, or other
AWS resource was created, changed, or deleted. No secret, recipient address,
message, production record, or customer data was read. Evidence was collected
at `2026-09-10T20:04:21.190Z` from source commit
`fd21a1366eaeeaca666107a781d0f5021a523bd5` on branch
`codex/aws-ses-staging-readiness-20260910`.

## Inspection boundary and caller

- Account: `559054714699`
- Region: `us-east-1`
- Principal:
  `arn:aws:sts::559054714699:assumed-role/AWSReservedSSO_TracePointMigrationStaging_52cda9da92884a87/jason.phares`
- DNS zone: `tracepointhq.com`
- Public authoritative provider: Wix, delegated to `ns10.wixdns.net` and
  `ns11.wixdns.net`
- SES APIs: SES v2 only
- Suppressed destinations were deliberately not enumerated because that API
  returns recipient email addresses. The configuration state is proven below;
  entry-level reconciliation remains a separately authorized data operation.

## SES account and sandbox state

`aws sesv2 get-account` returned:

| Field | Current value | Assessment |
|---|---:|---|
| `ProductionAccessEnabled` | `false` | Account is in the SES sandbox in `us-east-1` |
| `SendingEnabled` | `true` | Account-level sending is enabled; identity-level sending is not |
| `EnforcementStatus` | `HEALTHY` | No probation or shutdown condition |
| `Max24HourSend` | `200` | Current regional daily quota |
| `MaxSendRate` | `1/second` | Current regional rate quota |
| `SentLast24Hours` | `0` | No regional sends in the preceding 24 hours |
| Account suppression | `BOUNCE`, `COMPLAINT` | Enabled for both reasons |
| Pricing plan | `ESSENTIALS` | Current account plan reported by SES |
| `Details.ReviewDetails` | absent | No production-access request has been submitted in this Region |

While sandboxed, sends can go only to: (1) an individually verified email
identity, (2) the SES mailbox simulator, or (3) a real address at any domain
identity already verified in this account and Region. A verified sender is
still required. The current failed identity and `REJECT_MESSAGE` MAIL FROM
fallback prevent even those tests until repaired.

## SES identity, DKIM, MAIL FROM, SPF, and DMARC

The account contains one identity only.

| Control | Current state | Evidence and consequence |
|---|---|---|
| Identity | `staging.tracepointhq.com`, type `DOMAIN` | `VerificationStatus=FAILED`; `VerifiedForSendingStatus=false`; `SendingEnabled=false` |
| Verification failure | `HOST_NOT_FOUND` | Last checked `2026-09-08T05:29:50.997-04:00`; Easy DKIM verifies ownership, and all three required DKIM hosts are absent |
| DKIM | Easy DKIM, origin `AWS_SES`, signing enabled, `FAILED` | Three current tokens exist; signing zone is `dkim.amazonses.com`; current and next key length are RSA 2048; keys generated `2026-09-05T05:28:55.452-04:00` |
| Custom MAIL FROM | `bounce.staging.tracepointhq.com`, `FAILED` | Required MX host is absent. `BehaviorOnMxFailure=REJECT_MESSAGE`, so SES returns `MailFromDomainNotVerified` instead of sending while unresolved |
| MAIL FROM SPF | absent | `bounce.staging.tracepointhq.com` is NXDOMAIN; there is no SPF policy for the envelope sender |
| DMARC for staging identity | inherited, monitor-only | `_dmarc.staging.tracepointhq.com` is NXDOMAIN, so the organizational-domain record applies: `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com`. It is a single valid policy, but it does not enforce quarantine/reject and reports to Brevo |
| Identity default configuration set | `tracepoint-staging` | Present on the identity |
| Feedback forwarding | `true` | SES email forwarding is enabled, but no monitored/deliverable forwarding mailbox was proven. `staging.tracepointhq.com` is a CNAME to an ALB and has no mail exchanger |
| Identity authorization policies | none | `Policies={}` |

### Root cause

The identity was created on September 5, but its DNS outputs were never
published at the authoritative Wix provider. SES searched for the names, could
not find them, and moved identity verification, DKIM, and MAIL FROM to terminal
`FAILED` states. There is no stale or incorrect SES record at the expected
owners: the records are wholly missing.

The existing `staging.tracepointhq.com` CNAME to the staging ALB is valid and
must remain. It does not conflict with DKIM records below `_domainkey` or with
the separate `bounce.staging` owner. Do not attempt to add an SES verification
TXT record at `staging.tracepointhq.com`: Easy DKIM uses the three CNAMEs for
domain ownership, and a CNAME owner cannot also carry TXT records.

## Public DNS findings

Authoritative lookups against `ns10.wixdns.net` and recursive lookups against
Cloudflare returned the same answers.

| Name and type | Public answer | Classification |
|---|---|---|
| `tracepointhq.com NS` | `ns10.wixdns.net`, `ns11.wixdns.net` | Correct authority |
| `tracepointhq.com MX` | priority 10 `tracepointhq-com.mail.protection.outlook.com` | Existing Microsoft 365 inbound mail; leave unchanged |
| `tracepointhq.com TXT` | Microsoft SPF, Microsoft verification, Brevo verification | Existing unrelated records; leave unchanged |
| `_dmarc.tracepointhq.com TXT` | one valid `p=none` record with Brevo `rua` | Valid inherited policy; not duplicated |
| `staging.tracepointhq.com CNAME` | staging AWS ALB | Existing application routing; leave unchanged |
| Three current DKIM CNAME owners | NXDOMAIN | Missing |
| `bounce.staging.tracepointhq.com MX` | NXDOMAIN | Missing |
| `bounce.staging.tracepointhq.com TXT` | NXDOMAIN | Missing |
| `_dmarc.staging.tracepointhq.com TXT` | NXDOMAIN | No explicit subdomain policy; valid apex policy is inherited |

No duplicate or conflicting record exists at any required SES owner. Public DNS
cannot prove that no unrelated, undiscoverable record exists elsewhere in the
zone, but it conclusively proves the exact SES owners are absent. Wix is the
place where the user must make these changes; an AWS Route 53 change would not
be authoritative.

## Exact provider-ready DNS changes

In the Wix `tracepointhq.com` zone, use the relative **Host/name** shown below.
Wix may display the resulting FQDN after saving; do not append
`.tracepointhq.com` twice. Use TTL 3600 seconds, matching the current public
zone. Targets may be accepted with or without a final dot by the provider.

### Required to clear the current SES failures

| Type | Host/name | Value/target | Priority | TTL | Purpose |
|---|---|---|---:|---:|---|
| CNAME | `3drryitjdubjinnkgryh3tbpzxoinewk._domainkey.staging` | `3drryitjdubjinnkgryh3tbpzxoinewk.dkim.amazonses.com` | — | 3600 | Easy DKIM token 1 and domain ownership |
| CNAME | `vzklmpevtuvf4g3sqev3y3z7eknsmsu5._domainkey.staging` | `vzklmpevtuvf4g3sqev3y3z7eknsmsu5.dkim.amazonses.com` | — | 3600 | Easy DKIM token 2 and domain ownership |
| CNAME | `e5uy6cdpk3j3wy2iezyywdqqqqhoerdu._domainkey.staging` | `e5uy6cdpk3j3wy2iezyywdqqqqhoerdu.dkim.amazonses.com` | — | 3600 | Easy DKIM token 3 and domain ownership |
| MX | `bounce.staging` | `feedback-smtp.us-east-1.amazonses.com` | 10 | 3600 | Custom MAIL FROM bounce processing and SPF alignment |
| TXT | `bounce.staging` | `v=spf1 include:amazonses.com -all` | — | 3600 | Authorize SES as the only sender for the dedicated MAIL FROM subdomain |

All five are creates. No DNS update or removal is required now. In particular,
do not change or remove the apex Microsoft 365 MX/SPF records, Microsoft/Brevo
verification TXT records, apex DMARC record, or staging ALB CNAME.

### Optional explicit staging DMARC policy

DMARC already applies through inheritance, so this record is not required to
clear any SES status. If TracePoint wants staging to stop inheriting the apex
Brevo report destination, create the following after choosing whether aggregate
reports are needed:

| Type | Host/name | Value/target | Priority | TTL | Purpose |
|---|---|---|---:|---:|---|
| TXT | `_dmarc.staging` | `v=DMARC1; p=none;` | — | 3600 | Explicit staging monitor policy with no aggregate report destination |

Do not add that optional record if the existing Brevo `rua` reporting is still
desired for staging. A later move from `p=none` to `quarantine`, then `reject`,
should occur only after legitimate DKIM/SPF alignment has been observed.

## Configuration sets, suppression, SNS, and feedback handling

### Configuration set

Only `tracepoint-staging` exists. Its state is:

- sending enabled;
- TLS policy `REQUIRE`;
- reputation metrics enabled;
- suppression reasons `BOUNCE` and `COMPLAINT`;
- one enabled event destination named
  `DeliveryConfigurationFeedbackEvents6D02B69B-454zIIuRR2wp`;
- matching events: `DELIVERY`, `BOUNCE`, and `COMPLAINT`;
- destination:
  `arn:aws:sns:us-east-1:559054714699:tracepoint-staging-ses-feedback`.

The proposed `tracepoint-staging-cognito` configuration set is not deployed and
is not part of current readiness.

### Feedback transport

- SNS topic is encrypted with customer-managed KMS key
  `9dd5adb8-3fb7-44ae-8b0b-24caa642a11c`.
- The topic policy allows `ses.amazonaws.com` to publish only from account
  `559054714699` and configuration-set ARN
  `arn:aws:ses:us-east-1:559054714699:configuration-set/tracepoint-staging`.
- One authenticated, confirmed SQS subscription exists; raw message delivery is
  `false`.
- Main queue:
  `arn:aws:sqs:us-east-1:559054714699:tracepoint-staging-ses-foundation-FeedbackQueueC15639F7-YvUodgnMIlt7`.
- Subscription failures and main-queue processing failures both route to:
  `arn:aws:sqs:us-east-1:559054714699:tracepoint-staging-ses-foundation-FeedbackDeadLetters07994F3B-jTP50RioZdGI`.
- Main-queue redrive is `maxReceiveCount=5`; both queues retain messages for 14
  days and enforce TLS. The queues use SQS-managed server-side encryption, not
  the topic's customer-managed KMS key.
- Main queue, in-flight, delayed, and DLQ visible-message counts were all zero.
- There is no Lambda event-source mapping for the main queue, and the
  `tracepoint-staging-ses-feedback-worker` CloudFormation stack does not exist.
  Therefore delivery/bounce/complaint events can be durably queued, but nothing
  currently validates, persists, or acts on them.

Account suppression and configuration-set suppression are both enabled for hard
bounces and complaints. The actual account suppression entries were not read,
and the prepared application suppression store has no live consumer. A prior
provider suppression/opt-out import and reconciliation therefore remains a
production blocker.

## Identity changes and DKIM token stability

- **Do not delete or recreate the identity.** Recreating an Easy DKIM identity
  is a new verification operation and can issue a different token set. Existing
  DKIM CNAMEs must then be treated as stale until compared with the new API
  response.
- Restarting Easy DKIM on this `FAILED` identity with
  `PutEmailIdentityDkimSigningAttributes` can also change the tokens. Read the
  returned tokens/signing zone immediately and change DNS only when they differ.
- Restarting custom MAIL FROM with the same domain and
  `REJECT_MESSAGE` behavior does not rotate DKIM tokens.
- Leaving retired CNAMEs indefinitely is unsafe dangling DNS. If a restart does
  rotate tokens, first publish and verify all new CNAMEs, then remove the three
  retired owners after SES reports success.

## Safest repair order and expected timing

1. **In parallel with DNS ownership work, prepare the feedback consumer.** It
   must validate SNS envelopes, persist delivery/bounce/complaint events
   idempotently, enforce suppression before send, retry safely, alarm on DLQ
   growth, and use only synthetic/authorized recipients for acceptance.
2. **Create the five required Wix records as one reviewed batch.** Do not touch
   the existing ALB CNAME or apex mail/authentication records.
3. **Verify authoritative and recursive DNS.** All three CNAMEs must resolve to
   the exact current token targets; `bounce.staging` must have exactly the SES MX
   and exactly one SPF policy. With Wix's current 3600-second TTL/negative cache,
   allow minutes to about one hour for public visibility, although resolver
   caches can take longer.
4. **After DNS is public, authorize an Easy DKIM restart in place.** This is
   necessary because status is already `FAILED`; do not recreate the identity.
   Re-read tokens immediately. If they changed, publish the replacement CNAMEs,
   confirm them publicly, and later remove only the retired token owners.
5. **After the exact MX is public, authorize a custom MAIL FROM restart in
   place** using `bounce.staging.tracepointhq.com` and preserving
   `REJECT_MESSAGE`. A `FAILED` MAIL FROM state no longer performs DNS detection
   until setup is restarted.
6. **Re-read one identity response until all three gates pass together:**
   `VerifiedForSendingStatus=true`, `DkimAttributes.Status=SUCCESS`, and
   `MailFromDomainStatus=SUCCESS`. SES often detects publicly visible records
   within minutes, but AWS documents a search window of up to 72 hours; 72 hours
   is an outer bound, not the expected wait.
7. **Complete feedback acceptance while still sandboxed.** Use the SES mailbox
   simulator or an explicitly verified synthetic mailbox/domain, prove delivery,
   bounce, complaint, durable suppression, retry, and DLQ behavior, and confirm
   raw headers show `dkim=pass`, `spf=pass`, and `dmarc=pass` for a real mailbox
   test. Sending any test requires separate explicit authorization.
8. **Submit production access only after the identity and feedback controls are
   true.** The request is regional and creates an AWS Support review. AWS states
   an initial response is normally provided within 24 hours when it can do so;
   review can take longer if more information is needed. There is no safe
   assumption of automatic approval or a fixed completion time.
9. **After approval, perform a separately authorized low-volume synthetic send
   and observe feedback before enabling Cognito or application traffic.** Keep
   Brevo active until the SES sender, consumer, suppression reconciliation, and
   rollback path all pass.

Fastest safe elapsed path is to publish DNS and build/deploy the feedback
consumer concurrently, restart the two terminal SES checks as soon as DNS is
public, run sandbox acceptance, then submit the already-prepared production
request. DNS/SES detection is commonly same-day but has a documented 72-hour
outer window; the production review normally begins with a response within 24
hours and may extend beyond it.

## AWS actions requiring explicit authorization

None of these actions was performed:

1. Restart Easy DKIM in place for `staging.tracepointhq.com`, then read and act
   on any returned token change.
2. Restart custom MAIL FROM in place with the existing
   `bounce.staging.tracepointhq.com` and `REJECT_MESSAGE` settings.
3. Deploy and authorize the feedback worker, its database connection, alarms,
   and least-privilege queue/KMS access; reconcile existing provider
   suppression/opt-outs without exposing recipient data.
4. Grant least-privilege `ses:SendEmail` authority pinned to
   `notifications@staging.tracepointhq.com` and the verified domain, with the
   required configuration set.
5. Send any synthetic test email or simulator event.
6. Submit the `us-east-1` SES production-access request.
7. Activate Cognito developer email or the application SES provider.

## Prepared production-access request

No request exists. The following is suitable for the SES console/Support case
after the readiness gates pass. Volume figures are conservative planning values
and must be confirmed by the TracePoint owner before submission.

**Form values**

- Mail type: `TRANSACTIONAL`
- Website URL: `https://tracepointhq.com`
- Region: `us-east-1`
- Proposed expected volume: approximately 500 recipients/day initially, with a
  conservative peak below 2,000 recipients/day and controlled rate limiting
- Contact language: `EN`

**Use-case text**

> TracePoint sends only transactional application email for police-agency
> personnel, including administrator-created account invitations, identity and
> password-recovery messages, workflow notifications, and requested operational
> digests. Recipients are personnel provisioned or invited by an authorized
> agency administrator, or users requesting an action for their own account. We
> do not use purchased, rented, scraped, or third-party marketing lists, and we
> do not send promotional email. We expect about 500 recipients per day at
> launch, with conservative peaks below 2,000 per day, and apply per-tenant and
> account rate limits. Hard bounces and complaints are published by SES through
> an account-scoped, encrypted SNS-to-SQS path, validated and processed
> idempotently, and placed on durable global suppression before any later send.
> Unsubscribed/opted-out recipients remain suppressed where the notification is
> optional; administrators can deactivate or correct agency accounts. We alarm
> on complaints, bounces, queue/DLQ backlog, and unusual volume; enforce
> least-privilege sender/configuration-set IAM; reject unapproved headers and
> recipients; and stop sending if feedback processing or suppression storage is
> unavailable.

The request must not be submitted until the present-tense claims about the
feedback consumer, suppression import, monitoring, and verified identity are
true. Submitting from the console records the required AWS Terms/AUP
acknowledgement and opens the Support review. If the SES v2 API is used instead,
the supported account fields are the production-access flag, transactional mail
type, website URL, contact language, and optional authorized team contacts; do
not pass the deprecated use-case-description API field.

## Blockers

1. The five mandatory DNS records are absent at Wix.
2. Identity verification and Easy DKIM are terminal `FAILED` and require an
   authorized in-place restart after DNS is correct.
3. Custom MAIL FROM is terminal `FAILED`, uses `REJECT_MESSAGE`, and requires an
   authorized in-place restart after its MX is correct.
4. The SES account remains sandboxed and no production-access request exists.
5. Feedback transport has no live consumer or worker stack.
6. Suppression/opt-out entries have not been reconciled from the active provider.
7. No monitored fallback mailbox for feedback forwarding is proven.
8. No authorized synthetic delivery/authentication/bounce/complaint acceptance
   has been run.
9. `tracepoint-staging-cognito` is not a deployed configuration set, and neither
   Cognito nor application SES sending is authorized for activation.

## Read-only evidence commands

The review used only identity/account/configuration reads, CloudFormation
descriptions, SNS/SQS attributes, a Lambda event-source-mapping list, and public
DNS queries. Principal commands included:

```text
aws sts get-caller-identity
aws sesv2 get-account
aws sesv2 list-email-identities
aws sesv2 get-email-identity --email-identity staging.tracepointhq.com
aws sesv2 list-configuration-sets
aws sesv2 get-configuration-set --configuration-set-name tracepoint-staging
aws sesv2 get-configuration-set-event-destinations --configuration-set-name tracepoint-staging
aws cloudformation describe-stacks --stack-name tracepoint-staging-ses-foundation
aws cloudformation describe-stack-resources --stack-name tracepoint-staging-ses-foundation
aws sns get-topic-attributes
aws sns list-subscriptions-by-topic
aws sns get-subscription-attributes
aws sqs get-queue-attributes
aws lambda list-event-source-mappings
Resolve-DnsName ... -Server 1.1.1.1
Resolve-DnsName ... -Server ns10.wixdns.net
```

Every AWS command used profile `tracepoint-member-staging` and Region
`us-east-1` where regional. No suppression-destination list call was made.

## Authoritative references

- [Request production access and sandbox restrictions](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
- [Creating and verifying SES identities](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html)
- [Easy DKIM](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim-easy.html)
- [Custom MAIL FROM states and restart behavior](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html)
- [DMARC authentication](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html)
- [SES event publishing](https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-activity-using-notifications-event-publishing.html)
- [SES account-level suppression](https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html)
