# Production cutover execution checkpoint — retry 4

Source authority remains Supabase project `izlkwggluhlhzlumtzes`. No final
capture, final-target import, Cognito authority change, SES worker repoint,
DNS change, or AWS application authority switch has occurred.

Cutover window ID: `cutover-20260928-retry4` (account `193644343389`,
`us-east-1`). This is an in-progress execution record, not acceptance.

## Active reversible controls

- Public maintenance stack:
  `arn:aws:cloudformation:us-east-1:193644343389:stack/tracepoint-production-maintenance-response-20260927/54efda90-bba1-11f1-93b2-0affe1e500c9`.
  Change set:
  `arn:aws:cloudformation:us-east-1:193644343389:changeSet/activate-complete-ingress-503-20260928f/b8175950-97a9-48f9-b2e1-1d00333dfd78`.
  Its diff was exactly the two reviewed listener-rule additions; stack
  `CREATE_COMPLETE`, external public and unmatched-host probes each returned
  the exact 503 body, and the original default forward remained unchanged.
- Exact Vercel project `prj_V03LJyQIc231luvZ9u0gcOAt4xK4`: temporary
  Preview deny `rule_trace_point_cutover_preview_deny_20260928_adO0mn`
  and Production deny `rule_trace_point_cutover_production_deny_20260928_6I1hSl`
  are active. External Production probe returned 403.
- Public bridge ECS service `tracepoint-production` in cluster
  `tracepoint-production` is at desired/running/pending `0/0/0`. Its task
  definition remains `tracepoint-production-bridge-rollback-20260926:1`.
- In exact production Supabase Auth, Email provider is disabled and new-user
  signup is disabled. Independent `/auth/v1/settings` read returned
  `email_enabled=false`, `signup_disabled=true`.

## Not yet active / mandatory next gate

- The operator confirmed the previous legacy HS256 signing key
  `b7859fb3-6f9d-4c82-87b5-04bfaca95259` is `Revoked`, and both legacy
  JWT API keys are disabled. A read-only public-anon bearer probe changed
  from HTTP 200 before to HTTP 401 after. The current ECC key remains out of
  scope. Production Email sign-in and signup remain disabled.
- The reviewed public SQL fence and guarded Auth session drain **have run**.
  The dedicated capture credential's status RPC reports `frozen=true`,
  `database=postgres`, 122 relations, 174 active public triggers, paused
  dispatcher, and fence timestamp `2026-09-28T21:20:19.900096-04:00`.
  Fresh SQL Editor verification reported zero Auth sessions and zero refresh
  tokens after the drain.
- The exact Vercel project is paused (`paused=true` by the project API) and
  retains both cutover firewall denies. Its external Production origin now
  returns HTTP 503; the public TracePoint host also returns HTTP 503. The
  public ECS bridge remains desired/running/pending `0/0/0`.
- The dedicated capture key remains distinct from the rollback key and
  successfully reads the source REST and Storage APIs. The source REST secret
  is already the reserved rollback key from the earlier pre-authority abort;
  this credential is not assigned to any *running* ECS bridge task.
- No production source capture A/B or final import has started. Final RDS
  resource ID remains `db-X4DYNS3TMVSAP7Z3RISDWEYDVE`; RDS available,
  deletion-protected, with a current PITR timestamp. The final capture
  CodeBuild project remains pinned to the production source package.

## Pre-authority inverse if the next gate fails

Keep maintenance and both Vercel denies active while restoring source Auth
and any SQL/credential controls actually changed. If the previous signing
key was revoked, the project owner must move that **same** key back to
Standby and verify legacy bearer read access before reopening traffic.
Do not try to recreate the permanently retired old modern `default` secret:
the current source REST secret already equals the reserved rollback key, which
is distinct from the capture key and read-tests 200. Verify source authority
and source-write continuity before removing Production then Preview denies,
restoring ECS desired count to 1, deleting only the exact two-rule maintenance
stack, and checking public 200 and original default forwarding. Do not
declare cutover complete from this checkpoint.
