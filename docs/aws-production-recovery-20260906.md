# Initial production hosting recovery and PITR requirements

Status: **AWS hosting recovery validated offline; production customer-data PITR
not validated**. The initial hosting state retains production Supabase for
database, authentication and object storage and retains Brevo for email. No
production customer record or object was read or changed in this work.

## AWS hosting recovery evidence

`scripts/validate-production-recovery.mjs` validates the strict synthesized
seven-stack assembly. It requires termination protection on every stack,
retained KMS keys, secret, ECR repository, task definitions, log groups, build
source/access-log buckets, WAF and alert queues; immutable scan-on-push ECR;
versioned build source; two desired tasks; deployment circuit-breaker rollback;
ALB deletion protection; enforced production WAF without the staging probe; and
the Supabase/Brevo/Supabase provider pins. It rejects RDS, Aurora and DynamoDB
claims because none are part of the initial state.

The runtime rollback unit is an immutable production image digest plus a
retained ACTIVE ECS task-definition ARN. Before traffic, deploy the reviewed
image, record the prior and current digests/task definitions, force the prior
definition, wait for completed rollout and healthy targets, then restore the
new definition and repeat those gates. The staging 21-to-18-to-21 rehearsal
proves the mechanism, but production must perform its own pre-traffic rehearsal.

## Production Supabase PITR gate

Before AWS production traffic is authorized, the data owner must provide dated
vendor-console/API evidence for the exact production project showing the backup
plan, PITR enabled state, retention window, earliest/latest restore points and
named owner. Restore to an isolated recovery project or approved vendor branch;
never restore over the live project for a rehearsal.

Time and record the restore. Validate the complete applied migration ledger,
schema/security fingerprints, tenant-isolation negatives, representative row
counts and approved non-sensitive hashes, critical relationships, current
qualification/readiness behavior and authentication metadata. Record measured
RPO/RTO against approved objectives, then destroy the isolated recovery target
through its approved cleanup path. Database PITR does not prove object-storage
recovery: separately export and reconcile a non-sensitive object manifest,
restore into an isolated target, verify checksum/tenant/audit behavior and clean
it up. Production Supabase evidence remains blocked on production authority and
data-owner approval; it receives no readiness credit here.

Brevo is configuration/state, not the system of record. Capture sender/domain
verification, suppression export/ownership and API-key rotation/revocation
evidence. The application secret cannot be automatically rotated until the
Supabase and Brevo vendor-side rotations are coordinated and rehearsed.

