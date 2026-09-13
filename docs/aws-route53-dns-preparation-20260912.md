# TracePoint Route 53 authoritative DNS migration preparation

Prepared 2026-09-12. This checkpoint is read-only with respect to AWS DNS,
Wix, the registrar, application traffic, Microsoft 365, and SES delivery. No
hosted zone, record, delegation, DS key, certificate, email, or budget was
created, changed, or deleted.

## Executive result

The Route 53 target is implemented as fail-closed CDK and synthesizes cleanly,
but it was not deployed. There is no Route 53 hosted zone in production, so no
hosted-zone ID or assigned Route 53 name servers exist yet.

Two independent gates prohibit delegation today:

1. The production permissions boundary implicitly denies
   `route53:CreateHostedZone`, while the Organizations SCP explicitly denies
   `route53:ChangeResourceRecordSets` and
   `route53domains:UpdateDomainNameservers`. Read operations are allowed. No
   policy was broadened.
2. Public RDAP identifies Wix.com Ltd. (IANA 3817) as the registrar. Wix's
   current documentation says a Wix-registered domain cannot replace its name
   servers; registration must first move to a registrar that permits custom
   name servers. The domain is also transfer/update locked.

The domain is currently DNSSEC-signed. The parent `.com` DS is:

`35882 8 2 BE5370254126A888C374E7133B0AE38CEE0582679AA6E2969773F05A84B0F0DC`

Changing authoritative servers while that DS points to Wix's signing key would
cause validating resolvers to return `SERVFAIL`. The parent DS must be removed
and allowed to expire before the name-server switch. Route 53 DNSSEC is enabled
and its new DS published only after the new delegation is stable.

## Inventory and completeness

The machine-readable live inventory is
`docs/aws-route53-dns-live-inventory-20260912.json`. The proposed target record
set is `infra/config/production-dns-target.json`.

Current authority:

- NS: `ns10.wixdns.net`, `ns11.wixdns.net`
- SOA: `ns10.wixdns.net support.wix.com 2026062713 10800 3600 1209600 3600`
- DNSSEC: enabled; DS observed through Google and Cloudflare validating
  resolvers
- CAA: no apex CAA RRset observed
- wildcard: a unique random label returned NXDOMAIN

The public inventory covers the apex, web hosts, staging, Microsoft 365 names,
SRV records, all certificate-transparency-discovered names, Brevo rollback
names, and all SES names. Direct DNS on port 53 timed out from this workstation,
but Google and Cloudflare DNS-over-HTTPS agreed on critical records; Google's
answers identified the Wix authoritative servers. AXFR was unavailable.

A complete DNS zone cannot be enumerated from public DNS without AXFR. The
in-app Wix session was not signed in, so an authoritative Wix dashboard export
could not be obtained. The prepared deployment therefore keeps
`cutoverReady=false`; authorization mode refuses to run until the export is
compared and every discrepancy is resolved.

## Microsoft 365 protection

The target preserves, unchanged:

- root MX `10 tracepointhq-com.mail.protection.outlook.com`
- root SPF `v=spf1 include:spf.protection.outlook.com -all`
- Microsoft verification `MS=ms61865803`
- `autodiscover`, `sip`, `lyncdiscover`, `enterpriseregistration`, and
  `enterpriseenrollment` CNAMEs
- `_sip._tls` and `_sipfederationtls._tcp` SRV records

SES SPF is present only on `bounce.tracepointhq.com`; it is never merged into or
used to replace the Microsoft 365 root SPF. No root MX change is proposed.

No Microsoft 365 `selector1` or `selector2` DKIM CNAME is publicly present; both
names returned NXDOMAIN. This is recorded, not guessed or synthesized.

## Website behavior

The requested “Wix-hosted website behavior” does not match live evidence. The
apex A record `216.198.79.1` is allocated to Vercel, `www` is a CNAME to
`cname.vercel-dns.com`, the apex returned HTTP 200 with `Server: Vercel`, and
`www` returned HTTP 307 to the apex. The Route 53 target deliberately preserves
those current values. It does not switch customer traffic to AWS or redefine
the later full-AWS application cutover.

The existing staging CNAME to
`tracep-servi-g9c0rkjqmcj4-947860151.us-east-1.elb.amazonaws.com` is also
preserved.

## SES records and discrepancies

The target contains the exact six owner-specified SES records at TTL 300:

| Type | Name | Value |
|---|---|---|
| CNAME | `t3pxf5n23dcf5ahxn4xzhcxfxnvushzh._domainkey.tracepointhq.com` | `t3pxf5n23dcf5ahxn4xzhcxfxnvushzh.dkim.amazonses.com` |
| CNAME | `yiaen5uag5n6evooqpo2rt3earh3zwcq._domainkey.tracepointhq.com` | `yiaen5uag5n6evooqpo2rt3earh3zwcq.dkim.amazonses.com` |
| CNAME | `yabannzf7xcqdnbgbxoee5k2c77xktci._domainkey.tracepointhq.com` | `yabannzf7xcqdnbgbxoee5k2c77xktci.dkim.amazonses.com` |
| MX | `bounce.tracepointhq.com` | `10 feedback-smtp.us-east-1.amazonses.com` |
| TXT | `bounce.tracepointhq.com` | `v=spf1 include:amazonses.com ~all` |
| TXT | `_dmarc.tracepointhq.com` | `v=DMARC1; p=none;` |

Live status: the three DKIM CNAMEs, MAIL FROM SPF, and owner-specified DMARC
value are present at TTL 3600. The MAIL FROM MX is absent. The live `_dmarc`
RRset also contains `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com`.
Multiple DMARC policy records can fail DMARC evaluation. The target retains only
the owner-specified SES value, but this semantic cleanup must be explicitly
approved before deployment or delegation.

Brevo verification, branded CNAMEs, and DKIM CNAMEs are retained in the target
as rollback-only compatibility records. Their presence in DNS does not put
Brevo in the AWS application runtime; removal belongs to the separately gated
Brevo/Supabase decommissioning phase.

## Prepared Route 53 stack

`infra/bin/production-dns.ts` synthesizes exactly:

- one retained `AWS::Route53::HostedZone` for `tracepointhq.com`;
- 23 reviewed `AWS::Route53::RecordSet` resources;
- no manually copied NS, SOA, DNSKEY, CDS, DS, or RRSIG records;
- no Route 53 Domains, ECS, RDS, Cognito, Lambda, application, or traffic
  resources;
- outputs for the future hosted-zone ID and four assigned name servers;
- hard activation and DNSSEC gates.

Authorized mode additionally requires all manifest blockers to be removed, an
exact `OWNER-ROUTE53-*` reference, a matching environment authorization, and
the `TracePointMigrationProduction` assumed role in account `193644343389`.
The current manifest intentionally makes authorized mode impossible.

Offline synth command:

```powershell
npx.cmd cdk synth --app "npx ts-node --prefer-ts-exts bin/production-dns.ts" `
  -c productionOperation=preview `
  -c authorizationReference=OWNER-ROUTE53-PREPARATION-20260912 `
  --output cdk.out.route53
```

The narrow future permission review must cover only hosted-zone creation,
tagging, reads, and record changes for this stack. The observed minimum blocked
actions are `route53:CreateHostedZone` and
`route53:ChangeResourceRecordSets`; registrar mutation remains separately
denied. No `route53:*`, general CloudFormation deployment, Route 53 Domains
administration, IAM mutation, or unrelated service access is justified.

## Cost

- Incurred by this checkpoint: **$0.00**.
- Unsigned Route 53 zone: **$0.50/month**, plus **$0.40 per million** standard
  queries for the first billion per month. Alias queries to eligible AWS
  targets are free, but the initial target preserves ordinary Vercel records.
- Later DNSSEC: one Route 53-compatible customer-managed KMS key adds
  **$1.00/month** plus request charges; Route 53 recommends assuming one regular
  refresh per day for KMS request estimation.
- Fixed projected DNS total after DNSSEC: **$1.50/month**, plus negligible DNS
  and KMS usage at current scale.

The $150 production budget was verified unchanged. No budget increase is
required or proposed.

## Fail-closed migration sequence

1. Export every Wix DNS record with type, owner, value, priority, and TTL.
   Compare it with both JSON manifests. Resolve every missing or conflicting
   record; no unexplained difference is acceptable.
2. Obtain a narrow authorization for this hosted-zone stack only. Create the
   zone while Wix remains authoritative. Record the hosted-zone ID and four
   assigned Route 53 name servers.
3. Query each assigned Route 53 server directly for every record in the target
   manifest and for explicit negative cases. Compare name/type/value/priority;
   NS and SOA are the only provider-specific exceptions. Verify HTTPS behavior,
   Microsoft MX/SPF/Autodiscover/SRV, SES records, CAA absence, and no wildcard.
4. Resolve the duplicate DMARC policy with explicit owner approval. Add the
   missing SES MAIL FROM MX to the target. Do not send email.
5. Unlock and transfer domain registration away from Wix to an approved
   registrar while retaining `ns10.wixdns.net` and `ns11.wixdns.net`. This is a
   separate registrar action; do not change delegation during transfer.
6. At the new registrar, remove the current Wix DS. Wait at least the maximum
   observed DS TTL and until independent validating resolvers return no DS. AWS
   recommends allowing up to three days for DNSSEC disablement safety.
7. At the separately authorized window, replace exactly the two Wix name
   servers with the four Route 53-assigned servers. Do not alter any other
   registrar setting. Wix states propagation may take up to 48 hours.
8. Continuously verify the apex and `www`, staging, Microsoft 365 records, and
   SES DNS through multiple public resolvers. Because old and new zones are
   identical, mixed-cache traffic remains safe.
9. After at least 48 hours of clean service, enable Route 53 DNSSEC with a
   dedicated KMS KSK and publish the new Route 53 DS at the registrar. Verify
   the chain with validating resolvers. Keep the Wix zone intact through the
   observation window.

Suggested pre-window TTL work: after authoritative export parity, lower the
business RRsets with TTL 3600 to 300 at Wix at least 48 hours before delegation.
This is a separately authorized Wix mutation. Parent NS and DS caching are
controlled by the registry/registrar and require their own propagation waits.

## Go/no-go and rollback

No-go conditions include: any unexplained record mismatch; missing Microsoft
MX/SPF/Autodiscover/SRV; multiple DMARC policies; target server disagreement;
parent DS still present; Wix export unavailable; certificate renewal in
progress; target website/redirect mismatch; or any permission broader than the
reviewed zone stack.

After delegation, roll back on sustained DNS `SERVFAIL`/NXDOMAIN, Microsoft 365
record mismatch, website failure, TLS failure, or authoritative disagreement:

1. Replace the four Route 53 name servers at the registrar with exactly
   `ns10.wixdns.net` and `ns11.wixdns.net`.
2. Keep the parent DS absent during rollback so it cannot point at the wrong
   signing key.
3. Monitor public resolvers for up to 48 hours. Do not delete the Route 53 zone
   or Wix records.
4. After Wix authority is globally stable, re-enable Wix DNSSEC only through a
   separately reviewed DS operation.

The rollback source remains intact; this plan contains no destructive step.

## Post-cutover verification checklist

- Parent NS equals the four Route 53 name servers; all four agree.
- Apex HTTP 200 and `www` 307 behavior match the baseline until the later
  separately authorized AWS application traffic cutover.
- Root MX and SPF remain exactly Microsoft 365; Autodiscover and Teams/Skype
  CNAME/SRV records resolve.
- The three SES DKIM CNAMEs, MAIL FROM MX/SPF, and single DMARC record resolve.
- SES identity and MAIL FROM become verified, but no email is sent without
  explicit authorization.
- No unexpected CAA or wildcard exists.
- CloudWatch Route 53 query-count metrics appear; no paid query logging or
  health checks are enabled by this stack.
- After DNSSEC re-enable, parent DS matches the Route 53 KSK and validating
  resolvers return authenticated answers without `SERVFAIL`.

## Single next owner action

Provide an authoritative Wix DNS export (all records and TTLs) and approve a
registrar-transfer plan to a provider that permits custom name servers. Do not
change name servers or DS yet. Only after export parity and registrar choice are
settled should the owner consider a narrowly scoped Route 53 hosted-zone
creation authorization.

## Authoritative references

- [AWS: Making Route 53 the DNS service for an existing domain](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/MigratingDNS.html)
- [AWS: Hosted-zone migration, including DS removal and DNSSEC re-enable](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zones-migrating.html)
- [AWS: Route 53 pricing](https://aws.amazon.com/route53/pricing/)
- [AWS: KMS pricing](https://aws.amazon.com/kms/pricing/)
- [Wix: Wix-registered domains cannot change name servers](https://support.wix.com/en/article/request-changing-name-server-ns-records-for-a-wix-domain)
- [Wix: connecting a Wix domain to an external site](https://support.wix.com/en/article/connecting-a-wix-domain-to-an-external-site)
- [Verisign public RDAP result for `tracepointhq.com`](https://rdap.verisign.com/com/v1/domain/tracepointhq.com)
