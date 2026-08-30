# Email provider decision

## Decision

Retain Brevo through hosting, database and Auth migration. SES offers tighter AWS
integration and potentially lower unit cost, but changing deliverability during
identity migration would compound risk.

Current behavior is two direct Brevo REST sends: activation and queued digest.
Both use `BREVO_API_KEY` and `TRACEPOINT_FROM_EMAIL`; the queue records delivery
state. First add an email contract while preserving exact sender, subject/body,
recipient, provider error and retry semantics.

Before SES adoption verify domain identity/DKIM/SPF/DMARC ownership, sandbox exit,
sending quotas, dedicated/shared reputation choice, complaint/bounce SNS handling,
account-level suppression behavior, template rendering, unsubscribe/legal rules,
audit correlation and incident ownership. Route delivery events to a durable
queue and update application delivery state idempotently. Never expose recipient
PII in operational logs.

Move only after parallel template snapshots, seeded deliverability tests,
bounce/complaint simulation, suppression reconciliation and rollback to Brevo.
Invitation/activation mail is security-sensitive and migrates last within email.
