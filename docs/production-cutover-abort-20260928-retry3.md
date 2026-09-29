# Production cutover abort: 2026-09-28 retry 3

Authority remained with Supabase project `izlkwggluhlhzlumtzes` throughout. No final capture, RDS import, Cognito authority change, SES worker repoint, DNS change, or AWS application authority switch occurred.

## Executed and verified

- The reviewed two-rule ALB maintenance stack reached `CREATE_COMPLETE`; exact public and unmatched-host probes returned 503, with the default forward unchanged.
- Exact Vercel Production and Preview deny rules were active; the public ECS bridge drained to 0/0.
- Production Auth Email/signup were disabled and the public-table source fence committed. Independent SQL verification returned `frozen=true`, 174 enabled ALWAYS triggers, three RLS-enabled private bookkeeping tables, one paused dispatcher, zero Auth sessions, and zero refresh tokens.
- Both legacy JWT API keys (`anon`, `service_role`) were disabled in the production Supabase dashboard under the explicit cutover approval.
- The old modern `default` secret API key was retired. After propagation, direct old-key REST reads/writes and Auth admin reads returned 401; Storage returned the same `400 InvalidRequest/Error` as a deliberately invalid key, while the dedicated capture key returned 200. The absent-row probe remained empty.

## Failed safety gate

The Supabase dashboard states that disabling the legacy keys affects the `apikey` header but **does not revoke their validity as JWTs**. Supabase's [JWT signing-key documentation](https://supabase.com/docs/guides/auth/signing-keys) confirms this distinction. Thus disabling `anon` and `service_role` alone cannot prove the approved requirement that both credentials are rejected as possible bearer tokens. An attempt to copy the production `service_role` JWT to the system clipboard for a direct negative was rejected by the execution guard; it was not bypassed. No final capture was started because the authoritative-writer fence was not fully proven.

This is a source-authority safety gap, not a relational importer or application issue. Before another maintenance window, a separately reviewed and rehearsed reversible control for the legacy JWT signing authority (or another exact way to deny privileged bearer use) and a non-exposing direct negative test are required. Do not assume dashboard API-key disable is sufficient.

The S3 protocol switch appeared off immediately after Save but appeared enabled on a later dashboard reload. The project showed zero separate S3 access keys, so this was not evidence of an active S3-key writer; nevertheless the switch alone must not be counted as a persistent fence control in a future attempt.

## Pre-authority restoration

- Re-enabled both legacy JWT API keys in the production dashboard.
- Distributed the reserved rollback/resume modern key to the exact production application and migration REST secrets and to the Vercel Production environment. Fresh Vercel deployment `dpl_5dAS93HYvDyZEVPKtsaQSnM8sfJH` reached READY behind the deny rule at pinned Git SHA `6588576ee2c3e95c2094e37c22ee64d0cbfad357`.
- Restarted the pullable bridge task definition `tracepoint-production-bridge-rollback-20260926:1`, with ECS desired/running 1/1.
- Restored Auth Email/signup; exact-source Auth settings returned Email enabled and signup allowed. S3 protocol was verified enabled, with no separate S3 access keys.
- Executed the versioned SQL abort transaction. Independent SQL verification returned zero cutover schemas, zero fence triggers, one active dispatcher, and the original department-permission function hash `5537f428cb4f1fac15320843cb213faa`.
- A rollback-key PATCH of an attested absent Fleet ID returned 204, with empty reads before and after; no record was persisted.
- Removed only the two cutover-window Vercel deny rules; exact project now has zero cutover rules and its public Production page returns 200.
- Deleted only the two maintenance listener rules via the reviewed stack reversal. External public and unmatched-host probes returned 200 and the original listener default forward remained unchanged.

The old modern `default` secret key cannot be recreated; the reserved rollback key is now the source runtime credential. Keep the dedicated capture key restricted and unused until a reviewed retirement or next cutover attempt. Source authority is Supabase, with no dual-writer or AWS-only customer-write interval.
