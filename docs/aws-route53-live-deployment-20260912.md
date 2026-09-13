# TracePoint Route 53 pre-cutover deployment — live result

Completed 2026-09-12 ET in production account `193644343389`, region `us-east-1`. Wix remains authoritative; no registrar, delegation, parent DS, Route 53 DNSSEC, traffic, application, data, or email-sending action occurred.

## Live zone

- Hosted zone: `Z06725946QWMQBKB1JT8`
- Name servers: `ns-1725.awsdns-23.co.uk`, `ns-1133.awsdns-13.org`, `ns-746.awsdns-29.net`, `ns-401.awsdns-50.com`
- SOA: `ns-1725.awsdns-23.co.uk. awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400`
- Creation change: `/change/C08569111XPQCXPIW3RG5`, `INSYNC`
- Records: 29 reviewed RRsets plus provider NS and SOA, 31 total
- The zone stack is `CREATE_COMPLETE`; the records stack is `UPDATE_COMPLETE`. Both are termination protected, and the zone resource has retain policies.

All 29 manifest RRsets were queried directly against each of the four assigned servers: **116/116 exact value checks passed, 0 mismatches**. Public resolvers still return Wix `ns10.wixdns.net` and `ns11.wixdns.net`; the parent DS remains unchanged.

The complete seven-screenshot signed-in Wix export was reconciled after the initial public-only inventory exposed six omissions. The two ACM validation CNAMEs, three staging SES DKIM CNAMEs, and staging MAIL FROM SPF TXT were added at TTL 3600. The signed-in export gate now passes.

## Wix-to-Route 53 reconciliation

| Name | Type | Wix live value | Route 53 target value | TTL live → target | Status |
|---|---|---|---|---:|---|
| `tracepointhq.com` | A | `216.198.79.1` | same | 3600 → 3600 | MATCH |
| `tracepointhq.com` | MX | `10 tracepointhq-com.mail.protection.outlook.com` | same | 3600 → 3600 | MATCH |
| `tracepointhq.com` | TXT | Microsoft SPF, `MS=ms61865803`, Brevo verification | same three values | 3600 → 3600 | MATCH |
| `www.tracepointhq.com` | CNAME | `cname.vercel-dns.com` | same | 3600 → 3600 | MATCH |
| `staging.tracepointhq.com` | CNAME | existing AWS staging ALB | same | 3600 → 3600 | MATCH |
| `autodiscover.tracepointhq.com` | CNAME | `autodiscover.outlook.com` | same | 3600 → 3600 | MATCH |
| `sip.tracepointhq.com` | CNAME | `sipdir.online.lync.com` | same | 3600 → 3600 | MATCH |
| `lyncdiscover.tracepointhq.com` | CNAME | `webdir.online.lync.com` | same | 3600 → 3600 | MATCH |
| `enterpriseregistration.tracepointhq.com` | CNAME | `enterpriseregistration.windows.net` | same | 3600 → 3600 | MATCH |
| `enterpriseenrollment.tracepointhq.com` | CNAME | `enterpriseenrollment.manage.microsoft.com` | same | 3600 → 3600 | MATCH |
| `_sip._tls.tracepointhq.com` | SRV | `100 1 443 sipdir.online.lync.com` | same | 3600 → 3600 | MATCH |
| `_sipfederationtls._tcp.tracepointhq.com` | SRV | `100 1 5061 sipfed.online.lync.com` | same | 3600 → 3600 | MATCH |
| `send`, `r.send`, `img.send` | CNAME | three reviewed Brevo rollback targets | same | 3600 → 3600 | MATCH |
| `brevo1._domainkey`, `brevo2._domainkey` | CNAME | two reviewed Brevo rollback targets | same | 3600 → 3600 | MATCH |
| three SES Easy DKIM names | CNAME | three generated SES targets | same targets | 3600 → 300 | MATCH |
| `bounce.tracepointhq.com` | MX | NODATA | `10 feedback-smtp.us-east-1.amazonses.com` | — → 300 | INTENTIONAL ADDITION |
| `bounce.tracepointhq.com` | TXT | SES SPF | same | 3600 → 300 | MATCH |
| `_dmarc.tracepointhq.com` | TXT | approved policy plus conflicting Brevo policy | only `v=DMARC1; p=none;` | 3600 → 300 | INTENTIONAL CLEANUP |
| production and staging ACM validation | CNAME | two ACM validation targets | same | 3600 → 3600 | MATCH |
| three staging SES Easy DKIM names | CNAME | three SES DKIM targets | same | 3600 → 3600 | MATCH |
| `bounce.staging.tracepointhq.com` | TXT | `v=spf1 include:amazonses.com -all` | same | 3600 → 3600 | MATCH |

The exact unabridged 29-RRset values are in `infra/config/production-dns-target.json`. There are 27 matches, one approved addition, one approved cleanup, zero review-required discrepancies, and zero unexplained omissions. The currently delegated website remained Vercel HTTP 200 at the apex and HTTP 307 from `www`; Microsoft 365 MX, root SPF, verification, Autodiscover, Teams/Skype, and device records remained unchanged.

## Governance and isolation

Boundary v10 (`0d64a6…43d8d`) is preserved as the immediate reconciliation rollback. Final v11 (`50c675…62d87`) permits record changes only for zone `Z06725946QWMQBKB1JT8`, the CDK execution role, 26 exact names, five exact types, and `CREATE`/`UPSERT`/`DELETE`, with non-null multi-value guards. The SCP remains unchanged at `f38899…dcb62`; it explicitly denies every unrelated hosted zone and any reviewed-zone change outside the CDK execution role. Access Analyzer reported zero findings.

Simulation proved: exact-zone CloudFormation change allowed; unrelated-zone change explicit-denied; direct migration-role record change explicit-denied; further zone creation implicit-denied; `route53domains:UpdateDomainNameservers` explicit-denied.

The two stacks contain only one `AWS::Route53::HostedZone`, 29 `AWS::Route53::RecordSet`, and CDK metadata. ECS, RDS, Cognito, Lambda, EC2, ALB, S3, Route 53 Domains, application runtime, and customer-data resources total zero.

## Cost and rollback

Current incremental fixed cost is `$0.50/month`, plus `$0.40/million` standard queries. Future Route 53 DNSSEC would add one KMS key at `$1/month` plus negligible request charges, for `$1.50/month` fixed after separately authorized DNSSEC. The production budget remains exactly `$150`; it was not raised.

Safe rollback now is governance-only because the zone is undelegated and cannot affect users:

1. Confirm both DNS stacks have no in-progress operation.
2. To roll back only the reconciliation permission expansion, set boundary v10 as default: `aws iam set-default-policy-version --policy-arn arn:aws:iam::193644343389:policy/TracePointProductionBoundary --version-id v10 --profile tracepoint-production`.
3. No SCP rollback is required because the reconciliation did not change it; verify its canonical hash remains `f388995b2d63f445a8ded1dc94c41f5749132f170c0081674f7e18bc43bdcb62`.
4. Re-run simulations and verify boundary v10 and the unchanged SCP hashes above. Leave the undelegated retained zone intact; deleting it is unnecessary, would be destructive, and is not permitted by final governance.

## Future DNSSEC sequence and next owner action

Route 53 DNSSEC is disabled. The Wix parent DS remains active. Future order remains: validate/export parity → transfer registrar while retaining Wix NS → remove Wix DS and wait for no DS → separately authorize NS delegation → validate website/mail/SES → enable Route 53 DNSSEC → publish the new Route 53 DS.

The Route 53 zone is ready for the registrar-transfer phase, but not for delegation. The single next owner action is to approve the destination registrar and transfer procedure while retaining the Wix name servers and current DNSSEC state. Do not change NS or DS yet.
