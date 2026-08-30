# TracePoint AWS threat model

## Assets and boundaries

Public-safety personnel, firearms, qualifications, fleet/training records,
attachments, credentials and audit history cross browser→ALB→Next.js→Supabase/
Brevo initially, later member-account data services. Trust boundaries include
agency tenants, platform support mode, human vs service clients, CI/build, AWS
accounts and third-party providers.

| Threat | Existing/proposed mitigation | Remaining validation |
|---|---|---|
| Cross-agency data access | department context, RLS, scoped admin queries | negative test every privileged route |
| Service-role abuse | server-only secret and access checks | remove generic admin exposure; exact task role |
| Session/token theft | secure cookies/provider validation | cookie flags, revocation and Cognito issuer tests |
| Privilege escalation | DB permission matrix/platform separation | role-change races, support-mode audit |
| Malicious upload | server auth and private signed access | size/type limits, quarantine/malware scan |
| Secret leakage in build/log | Secrets Manager, BuildKit secret | CI masking/provenance and rotation drill |
| Supply-chain image compromise | lockfiles, immutable ECR, non-root image | SBOM/signing/scanning and base-image SLA |
| Internet task exploitation | ALB-only inbound SG | patch cadence, WAF decision, egress monitoring |
| Audit tampering | immutable DB triggers/central log design | retention/access/restore and actor continuity |
| Webhook replay/spoofing | signed timestamp+delivery ID design | canonicalization and replay-store tests |
| Data loss/ransomware | retained resources, PITR/runbooks | isolated restore test and deletion governance |
| Deployment privilege abuse | scoped bootstrap/deployer design | boundary/PassRole review in member account |

Abuse cases that block production: inactive member reads, department-ID
substitution, platform grant via configurable title, forged dispatch request,
presigned-key traversal, stale/replayed webhook, reused activation token, audit
write failure ignored, and deployment targeting management/production accounts.
