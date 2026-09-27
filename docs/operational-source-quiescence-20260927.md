# Operational source quiescence: cutover correction (2026-09-27)

Status: **PAID-REHEARSAL PROVEN; LIVE PRODUCTION PREFLIGHT BLOCKED**. The earlier
owner-lockout requirement is superseded. A trusted SQL/capture operator can
retain administrative ability, but must perform no source DDL/DML during the
frozen interval. An observed operator write is a hard stop. Every actual
customer, application, service, Auth, Storage, scheduled, and automated writer
must be technically blocked; two immutable captures must show zero unexplained
authoritative delta. The production SQL now targets only the 87 public tables,
but its activation retains an explicit fail-closed preflight exception until
all production-specific autonomous-writer controls are proved.

## Read-only project inventory

The signed-in Supabase dashboard identifies the live project as
`izlkwggluhlhzlumtzes`. At inspection it showed one modern publishable key,
one modern secret key, and legacy `anon`/`service_role` keys still active. The
Storage S3 protocol was enabled but had **zero separate S3 access keys**. The
Edge Functions page showed no deployed functions. No key value was recorded.
The paid rehearsal project `reukdouvpshshvqnzsgw` showed one publishable and
two secret keys (default and a rotated rehearsal capture key). This dashboard
inventory does not by itself identify every external holder or database
credential.

The repository's static Supabase inventory reports 597 data calls, including
89 inserts, 73 updates, 27 upserts, 26 deletes, and 41 RPC calls. It is a
source-code inventory, **not** runtime reachability proof. The production
bridge image embeds `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; its ECS task also
receives `SUPABASE_SECRET_KEY`. The separately pinned final-capture task reads
the production REST source secret through an AWS role and makes only reviewed
GET and fixed read-only POST requests. The live pg_cron dispatcher invokes a
legacy Vercel notification endpoint every 15 minutes; that specific job must
be paused and drained. The public ALB 503 covers `www.tracepointhq.com`, not
direct Supabase APIs or the legacy Vercel host. The legacy Vercel project is
still an independent writer surface with a Production-scoped server-key
variable: project
`prj_V03LJyQIc231luvZ9u0gcOAt4xK4`, Production origin
`https://tracepoint-amber.vercel.app`. Its reversible Production pause must
be verified separately (and Preview source binding excluded) before either
final capture; see `docs/production-legacy-vercel-writer-control-20260927.md`.

Supabase's current key model matters for reversal: legacy JWT-based keys can
be disabled and re-enabled, but a modern key is deleted rather than
temporarily disabled. Deletion cannot restore the same value. A live plan that
revokes a modern key must first prove an exact replacement-key, bridge-image,
runtime-secret, capture-secret, and rollback deployment path. Do not delete a
production modern key merely because maintenance is active. A server secret
key or separate S3 access key bypasses RLS, so public-table triggers and
Storage RLS alone are insufficient for those credentials.

## Required composite rehearsal before reopening maintenance

1. Pin the exact paid-project API-key IDs, legacy-key state, S3-key count,
   application holders, scheduled jobs, database clients, and independent
   source-capture key. Do not print credential values. Record baseline
   relational/Auth/Storage state and the active-session inventory.
2. Fence-off positive controls: a synthetic app data write, Auth mutation,
   Storage upload/delete, service-role write, and background job all succeed
   through their actual interfaces. No customer data is used.
3. Activate only reviewed, exact-project controls: external maintenance,
   bounded worker pause/drain, public-table trigger/RLS defense, database
   default read-only for new sessions, disable the legacy keys if used, and
   prevent autonomous use of modern keys. Preserve a separate trusted capture
   identity. A privileged SQL operator is not a negative-test target.
4. Fence-on negative controls: repeat each writer family and require a
   rejected request, identical authoritative before/after state, no queued or
   delayed mutation, and zero unexpected admin activity. Explicitly test
   direct Auth, direct Storage, PostgREST/RPC, server secret, S3 protocol,
   cron, and direct database clients where present. Any unfenced path fails
   the gate regardless of an unchanged aggregate count.
5. Run two separate immutable full capture jobs, at least 60 seconds apart,
   while all controls remain unchanged. Compare the 90 migration relations,
   Auth identities, memberships, audit/history relations, and every Storage
   object key/size/content hash/content type/tenant mapping. The comparator
   in `scripts/compare-frozen-source-captures.mjs` validates each artifact's
   byte hash and internal canonical hashes before evaluating parity. It is
   only one gate; it does not activate the fence or prove writer negatives.
   Separately compare schema/catalog fingerprint and active-session/audit
   evidence at both capture boundaries. Any unexplained delta fails closed.
6. Abort/unfence the paid project using the exact recorded inverse controls;
   prove the same positive writer controls work again and no stale fence
   remains. The live-production abort must additionally prove zero AWS-only
   writes and a single source authority before opening the bridge.

The production final-capture runner now expects the 122-relation catalog,
174 public-table triggers, paused dispatcher, and a pinned composite
attestation with every writer-family negative. It has fixed A/B run IDs;
the AWS-local comparator selects B only after an unchanged >=60-second
window. These source changes are not yet deployed to the CodeBuild executor.
The production preflight remains BLOCKED because direct production Auth/Storage
and other external writer controls/inverses are not yet verified. Do not run
either capture or reopen maintenance while it is blocked.

No live source key, schema, data, maintenance, DNS, or authority was changed
for this inventory. The live Supabase bridge remains the sole production data
authority.
