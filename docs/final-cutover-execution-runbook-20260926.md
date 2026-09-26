# TracePoint final cutover execution runbook (draft; execution NOT authorized)

This is an operator checklist, not a command to activate the production write freeze or switch public authority. The source of truth for gate status is the dated proof ledger and addendum. Any failed or unknown gate is **NO-GO**. Record exact resource IDs, image digests, artifact VersionIds, timestamps, operator, approver, and sanitized command output in the execution record before proceeding.

## 0. Immutable inputs and no-go conditions

Pin the approved production-origin AWS-native image digest, the exact final RDS DB identifier/resource ID/endpoint, database name `tracepoint`, exact production Cognito pool/client, private KMS-encrypted S3 bucket, and the captured public bridge task definition/image. Never use a mutable tag, unversioned source artifact, an unverified RDS hostname, or a shadow/rehearsal Cognito client for production. Confirm the final target is `tracepoint-production-final-cutover-20260926`, resource ID `db-X4DYNS3TMVSAP7Z3RISDWEYDVE`; reattest its current endpoint through the RDS control plane and CA-verified TLS. The production Cognito exact-target guard must be present in the selected image.

Stop before any write freeze if authentication/recovery, cross-tenant negatives, SES application delivery and feedback, final-source capture/apply, AWS-native isolated authority-switch, rollback-after-AWS-write, operational alerting, backup restore, or customer acceptance is unproved. Stop on source/target mismatch, ambiguous identity or tenant mapping, lost audit/rollback evidence, exposed secret, or unexplained customer-facing error. Do not accept sequence gaps or scan status as substitutes for relational/semantic reconciliation.

## 1. Pre-freeze snapshot and authority record

1. Confirm the public bridge ECS service/task, target group, DNS records, Cognito client, Supabase project, and live email dispatcher are in the approved baseline. Export their configuration and immutable identifiers without secret values. Capture final RDS and S3 inventory, backup/PITR timestamp, alerts and confirmed human recipient, and rollback image/task definition.
2. Confirm final RDS is private, encrypted, deletion-protected, has a recent `LatestRestorableTime`, approved schema lineage 99 and required transaction-local import guards, and has no unexpected customer rows. Confirm there is no production task reference to the final target yet.
3. Confirm operator, agency, and incident contacts and the exact freeze start, maximum permitted freeze window, decision deadline, and abort owner. Record a fresh recovery point for the live Supabase source and keep its original project and storage intact.

## 2. Source freeze (separate, explicit owner gate)

1. Announce maintenance and activate the reviewed public maintenance response before freezing writes. Do not merely block the browser: inventory service-role/API, Auth, Storage, RPC, background, and database writers.
2. Pause the live `tracepoint-notification-email-dispatch` pg_cron job; verify no invocation is in flight. Record its prior schedule/command hash and state so it can be restored on abort.
3. Activate the reviewed central Supabase source fence in one controlled transaction. Probe all approved writer families with rollback-only or synthetic safe negatives; require no persisted source mutation and exact fence status. Keep source reads available for capture. Record fence timestamp and a fresh source count/identity/object baseline.
4. If any writer bypasses the fence or any in-flight writer cannot be drained, abort while the bridge remains authoritative. Restore only the state needed to return to the pre-freeze bridge, then verify write continuity.

## 3. Frozen capture and target apply

1. From AWS, capture the exact frozen source with the pinned source project credential using the reviewed `run-source-rehearsal-final-capture.mjs` contract (the actual production source needs its separately approved exact-project configuration). No local customer artifact download. Require unchanged fence timestamp before and after, object inventory, identities, memberships, relation counts, canonical master hash, whole-file SHA-256, and S3 VersionId.
2. Run the guarded atomic importer against only the reattested final RDS. Require exact bucket/key/VersionId/whole-file hash/master hash, all relational writes in one PostgreSQL transaction, in-transaction full reconciliation, and commit only on exact parity. On failure, verify rollback removed all customer rows and preserve sequence-gap evidence without compensation.
3. Post-commit, independently reconcile all relation contracts, 4,813 baseline rows plus approved frozen delta, IDs, identities, memberships, audit history, authorization semantics, tenant ownership, object references, and sequence safety. Copy required objects create-only; reconcile keys, content lengths, full-object hashes, metadata, KMS, ownership, versioning, private ACLs, and both department-patch delivery routes. A changed final source requires a new immutable capture and explicit delta reconciliation, not reuse of the old 4,813-row baseline.

## 4. Cognito and email readiness

Stage/activate only the approved identity cohort from the frozen source, with exact subject links, disabled/inactive semantics, no duplicate email/subject, no bulk invitations, and reset-required first-login path. Verify the actual production pool/client, issuer, PKCE, MFA, callback/logout, token duration, session persistence, role/department mapping, disabled-user denial, recovery, and logout. Confirm SES domain/DKIM/MAIL FROM, application invite/recovery/notification delivery, correlated feedback, suppression, retry, and alarm ownership. A transport-only simulator pass is insufficient.

## 5. Isolated AWS-native authority rehearsal and final switch (switch is NOT authorized by this document)

Before any public switch, repeat the managed isolated rehearsal of the exact production-origin image/configuration, final-target secret pin, S3, Cognito, SES and IAM; verify health, ordinary-user workflows, direct bidirectional tenant negatives, rollback image, and no Supabase application data/storage writes. Synthesize/diff managed infrastructure and reject unexpected replacement or privilege expansion. This rehearsal is a precondition, not the public switch.

At the later separately approved switch gate only: recheck source fence, final target parity and restore point; deploy the reviewed immutable production task revision with AWS-native providers and exact final RDS/Cognito/S3/SES configuration; wait for healthy tasks and target group; switch public authority through the approved managed routing mechanism; verify TLS, login, Montville/Readington reads and writes, files, notification flow, alerts, and source remaining fenced. Record first AWS-authoritative write and its audit trail. Do not permit simultaneous source and AWS writers.

## 6. Abort and rollback decision

Before any AWS-only write: route back to the known-good bridge revision, verify public health, and restore source writes/dispatcher only after verifying the source remained authoritative and no AWS delta exists. After an AWS-only write: **do not simply repoint traffic to Supabase**. Stop AWS writes, preserve both sides and a new RDS recovery point, enumerate and reconcile the complete AWS-only relational/object/identity delta, replay only reviewed source-compatible writes while source remains externally fenced, verify audit and tenant parity, then restore bridge authority and source writes in a single-owner sequence. If complete safe replay is not possible, keep AWS fenced and invoke incident recovery; never create dual writers or discard the delta. The bounded one-record rehearsal is evidence of the mechanism, not blanket approval for arbitrary production replay.

## 7. Acceptance and closeout

Hold the old source, bridge task revision, snapshots, object versions, Cognito mapping, and logs until signed acceptance. Verify live alarms, human paging, backups, privacy/tenant isolation, data reconciliation, application smoke, and rollback readiness at the agreed observation interval. Only then separately authorize cleanup/decommissioning. Record every action and its reverse command in the execution log; leave all pending gates marked NO-GO rather than inferring success.
