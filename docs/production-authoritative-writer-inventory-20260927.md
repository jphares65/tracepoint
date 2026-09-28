# Production source writer inventory — pre-mutation checkpoint

Source: Supabase project `izlkwggluhlhzlumtzes`. This is a fail-closed
inventory, not a claim that the source is fenced. The 2026-09-27 TLS-verified
read-only catalog check found 87 `public`, 27 `auth`, and eight `storage`
tables, fingerprint `36558b0730e3e96cad6426f38088a5b0`, zero cutover
triggers, and no cutover schema. CloudTrail `GetSecretValue` events were
inspected as principal/count aggregates only; secret values were not emitted.
Secret **reads** prove access, not that the principal wrote Supabase.

Every row below is authoritative-write-capable unless it is explicitly
marked absent. An observed lack of writes is not a fence. The corresponding
real-interface negative and exact inverse are prerequisites to marking a row
controlled; `unproven` is not a synonym for `ephemeral`.

| Writer | Production identity / credential | Authoritative state affected | Reversible fence and restore | Proof status |
| --- | --- | --- | --- | --- |
| Public AWS bridge ECS | `tracepoint-production` service; `tracepoint-production-ecs-execution` reads application secret; runtime task uses public and elevated Supabase keys | Business rows, Auth admin, Storage via app routes | Reviewed public ALB 503, exact ECS desired count 1→0, public-table triggers; restore pinned bridge task/count only during pre-authority abort | Exact ECS scale/inverse passed on isolated Phase 3C service; live bridge untouched and cutover-time drain still required |
| Legacy Vercel Production | Project `prj_V03LJyQIc231luvZ9u0gcOAt4xK4`, Production source URL and elevated key | Same as bridge; cron dispatch endpoint | Exact-project pause; inverse unpause. Disposable project proved 200→503→200 | Production target verified; live control not active |
| Legacy Vercel historical Preview | Same project; historical immutable deployments may carry production URL/secret; automation bypass exists | Same as Production | Project-wide `Environment Equals Preview → Deny`; inverse delete exact rule | Exact Preview predicate/inverse passed against a signed-in disposable Preview deployment; live rule and historical URL negatives remain cutover-time gates |
| Auth existing-session user API | Already issued `authenticated` JWT + production publishable/legacy API key | `auth.users` metadata, credentials/recovery/MFA and other identity state | Rehearsed single-session revoke and provider restriction; restore provider/sign-in, not revoked session | Paid synthetic existing-token write negative passed; production session drain/control inventory pending |
| Auth new sign-in/refresh/signup | Public key or legacy anon key; Supabase Auth API; exact-project read-only `/auth/v1/settings` reports Email enabled and self-signup enabled | New identities, recovery/MFA; session fields unclassified until proven ephemeral | Reversible Auth provider/signup restriction plus session drain/revoke; restore exact settings | Paid negative/restore passed for selected flows; production Email/signup state now attested, but exact control and credential/recovery scope pending |
| Auth admin/service API | Elevated `sb_secret_`/legacy service key, held by bridge, Vercel, tooling | User create/update/delete, recovery, MFA, identity links | Stop every credential holder, do not delete modern key; direct admin negative during fence | Paid admin-create negative passed; all production holders not yet proven stopped |
| Storage authenticated API | User JWT + publishable/legacy key, `storage.objects` RLS | Object keys, bytes, metadata, ownership | Reviewed `has_department_permission` source-fence replacement plus public trigger layer; restore exact function | Read-only production RLS contract attested; direct negative in production pending cutover |
| Storage elevated API | Service/modern secret key; elevated role bypasses RLS | Same object authority | Stop all elevated-key holders; direct object-write negative; restore exact holders | Paid synthetic upload negative passed; production holder completeness pending |
| S3-compatible Storage | No separate production S3 access key in dashboard inventory; protocol may be enabled | Object keys, bytes and metadata if a key appears | Recheck exact project immediately before freeze; if any key appears, reversible S3 protocol/key control and negative required | Currently `NO_SEPARATE_S3_WRITER_CREDENTIALS`; recheck required |
| PostgREST direct browser/API | Public/legacy key and user token | RLS-protected public rows | 174 proposed public `ENABLE ALWAYS` trigger actions on 87 tables plus ingress controls; exact abort SQL removes only these | Paid service-role REST 55000 negative passed; production trigger package remains fail-closed |
| RPC/SECURITY DEFINER | PostgREST caller; live catalog has 30 public definer functions, 18 with direct DML text, seven of those executable by `anon`; 13 refer to Auth/Storage (often `auth.uid()`), zero with direct Auth/Storage-qualified DML text | Public rows; indirect Auth/Storage effects still require call-graph classification | Public triggers for public mutations; separate Auth/Storage control for any bypass | TLS-pinned catalog scan done; function call graph and real-interface negatives pending |
| Supabase scheduled cron/pg_net | One active `tracepoint-notification-email-dispatch` job every 15 min calling legacy Vercel | Notification queue and email/send side effects | Guarded `cron.alter_job(... active := false)`, drain `cron.job_run_details` and `net.http_request_queue`; restore pinned job snapshot | Exact job read-only attested previously; live pause/inverse only at cutover |
| Background/notification writers | Legacy Vercel dispatch; AWS SES feedback workers target their respective RDS paths, not Supabase source | Queue state, external delivery, feedback history | Pause source dispatcher and legacy Vercel; preserve separate AWS worker authority sequence | Source notification path identified; no proof yet that all external background invocations are drained |
| Admin/import tooling | Manual migration scripts, CodeBuild import/capture roles; no active import job approved | Public/Auth/Storage depending tool invocation | No starts during freeze; exact job/build inventory, active-run drain, operator audit; restore only reviewed jobs | AWS CodeBuild projects inventoried; all active executions and external schedulers need fresh check |
| AWS direct source-rest credential holders | CloudTrail roles `TracePoint-RestLedgerExec-4272874f`, `TracePoint-RestObjectCopyExec-4272874f`, `TracePoint-RestRdsImportExec-4272874f`, `TracePointMigrationProduction` | Source REST key is capable of public/Auth/Storage writes regardless of read-only program intent | Prevent new executions, verify zero active executions; preserve read-only final-capture role only; restore job eligibility if pre-authority abort | Holder names observed; exact role/job execution controls and negative pending |
| AWS application-secret readers not serving public traffic | CloudTrail roles `TracePoint-Phase3cRehearsalAppExec`, `tracepoint-production-aws-native-codebuild-image`, `tracepoint-production-aws-native-proof-execution-v1`, Phase 3B shadow execution role, plus migration operator | Secret may contain source-capable key; deployed native services do not expose Supabase env vars | Verify task/build configurations and active runs; revoke no key merely for proof; stop any job that can use it | Read access observed, but no source writes shown; role permissions and current workloads need complete attestation |
| External Supabase credential holders | Any non-AWS holder of production modern/legacy keys, including Vercel and unknown third-party integration | Public/Auth/Storage | Inventory key usage/configuration and every holder, then stop holder or prove no authoritative capability; no irreversible key deletion | Vercel known; Supabase project access/log inventory currently incomplete, so this remains unclassified |
| Privileged SQL/dashboard operator | Production SQL Editor `postgres`, source reader `tracepoint_migration_reader` (read-only) | Potentially any relation via trusted operator | No manual writes while frozen; audited access, capture A/B and source fingerprint; abort procedure pinned | Explicit trusted-human exception; read-only reader attested, operator procedure reviewed |

The public maintenance response controls only the AWS bridge ingress. It does
not block Supabase Auth/Storage, historical Vercel Preview, direct PostgREST,
an elevated key, SQL operator access, or an external integration. The final
production composite preflight must remain blocked until every row is either
proven absent or has a rehearsed reversible control, a direct negative or
appropriate immutable absence evidence, and a deterministic restore path.

## Additional read-only privilege and runtime check

The pinned, TLS-verified source catalog probe now reports managed-schema
privileges without reading customer rows. `tracepoint_migration_reader` has
table-level SELECT on `auth.users`, `auth.identities`, and `auth.mfa_factors`,
but lacks USAGE on schema `auth`, so it cannot directly capture those rows.
The `auth` schema is owned by `supabase_admin`; the available `postgres` role
has USAGE **without grant option** and is not a member of that owner. A direct
`GRANT USAGE` from this operator is therefore not an established path. The
reader does have USAGE and SELECT on `storage.objects`. This does not change
the approved reset-required Cognito migration; it identifies the limit of a
database-side Auth parity probe and leaves authoritative credential/MFA
changes dependent on the complete Auth writer fence.

For currently deployed AWS workloads, read-only ECS inspection confirmed that
only the public bridge task (`:4`, desired/running 1/1) injects Supabase
runtime secret names. The Phase 3B shadow (`:18`) and Phase 3C rehearsal
(`:23`) task definitions inject AWS-native database/auth secrets, not a
Supabase source key; the no-public-route native authority rehearsal service
remains desired/running 0/0. All three production-account CodeBuild projects
use S3 sources without webhooks; the final-source-capture project still has
no build. This narrows **active AWS processes**, not the set of dormant or
external holders of the still-active modern source secret key. The live
Supabase dashboard offers only irreversible deletion for that modern key;
no reversible key-disable control was found. No source key or project setting
was changed during this check.

Capture executor preparation remains non-operative. Commit `b2276b5` was
packaged as source SHA-256
`aeb8e7e6cae97b4cfb41cdc11c3de300d1e17f16143d9d814415d8516ed39076`
and uploaded create-only to the exact versioned, KMS-encrypted build-source
bucket as S3 VersionId `mIOCDtUM5HRWUrILGP3rIfoMssc49SdP`. The deployed
CodeBuild project still references the old `d09407...` source archive; no
capture build has started. A local-template change set exposed unrelated
project/role changes and was deleted unexecuted. The safer
`source-capture-param-only-b2276b5-20260927` change set uses the deployed
template and is **unexecuted**. It plans only the source-parameter-dependent
CodeBuild Source and exact-key role policy update; CloudFormation reports a
conditional project replacement possibility, so the stack must be reattested
before execution. No validation-error events were returned. Do not execute
it or start capture merely because the package exists; the full source-writer
preflight is still blocked.

A read-only exact-project Auth settings request through the pinned production
source REST secret returned HTTP 200 with only Email enabled and
`disable_signup=false`. The credential remained in a local process pipe and
was not printed. This closes the production provider-state inventory but does
not prove that new signup, recovery, refresh, or service-admin writes can be
blocked during the live freeze. The direct production project dashboard is
not accessible to the currently signed-in `jphares65` Supabase organization
view; it lists Development, Staging, and paid Rehearsal, but not Production.
The separate TLS-verified database reader cannot administer Auth settings or
inventory project-scoped key holders. Those controls remain fail-closed.
