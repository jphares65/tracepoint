# Production rollback control checkpoint — 2026-09-28

No public maintenance, source fence, credential retirement, frozen capture,
target import, or authority change occurred in this checkpoint.

- Exact production Supabase source `izlkwggluhlhzlumtzes`: TLS read-only catalog
  fingerprint `36558b0730e3e96cad6426f38088a5b0`, 122 relations.
- Exact final RDS resource ID `db-X4DYNS3TMVSAP7Z3RISDWEYDVE`: available,
  private, encrypted, deletion-protected; prior read-only task proved 99 migrations
  and zero Auth users.
- Old, capture-only, and reserved rollback Supabase credentials are distinct,
  valid only for the production source, and held at their pinned separate Secrets
  Manager paths. No key value was printed or changed.
- Exact Vercel team `team_HCPS7YRtZfKg7WZtSDfjhaSR`, project
  `prj_V03LJyQIc231luvZ9u0gcOAt4xK4`, Production variable ID
  `e80TWGMDKlzEEkIJ`, and baseline deployment
  `dpl_AfRHke111kN5zaHR7NGiMaqi4UMk` were freshly attested.
- The short-lived operator token created, patched and removed a synthetic env
  variable on approved disposable project `prj_wkk5IA0iS8cTKKuaTQoNbxYncCFw`;
  all three API responses were HTTP 200. It also created synthetic deployment
  `dpl_5X5Z8AxVJVcoBGSiD2XtMvc6cY69`, which reached READY. No live project
  variable or alias was changed.
- The live project's Preview `NEXT_PUBLIC_SUPABASE_URL` was decrypted only in
  memory and verified to point to isolated staging `wztqqqashilusoppddxi`.
  An exact pinned-commit Preview deployment
  `dpl_4vLxMAoBuJs3jrbYaswSHZCLgNr1` reached READY at Git SHA
  `6588576ee2c3e95c2094e37c22ee64d0cbfad357`, target Preview; no
  Production alias or source authority changed. The first request's HTTP 400
  identified a missing `gitSource.repoId`; the production abort request builder
  now supplies the independently attested repository ID.
- The actual public ECS task revision 4 injects both elevated environment
  names from `tracepoint/production/application:SUPABASE_SECRET_KEY`; applying
  the reserved rollback key changes that field alone. The transformed real
  secret payloads were validated in memory without mutation. IAM simulation
  allowed exact `secretsmanager:PutSecretValue` on the application secret and
  `ecs:UpdateService` on the public service. ECS remains desired/running 1/1.
- The public-table source-fence SQL's obsolete unconditional refusal was
  removed. It still checks exact role, database, 122-relation fingerprint,
  operator-owned permission function, pinned dispatcher, complete 174-trigger
  installation, and the same-transaction abort on mismatch. It remains only
  one layer of the composite writer fence; never run it before external
  maintenance, ECS/Vercel/Auth/credential controls are confirmed.

The Vercel Production environment-variable update and the ECS secret/restart
are **prepared and component-tested but have not been executed against live
production**. Their actual invocation is reserved for a pre-authority abort
under active maintenance and source fence, after the old credential epoch is
retired. The new Preview deployment proves the pinned Git source and API
permissions without exposing live Production to a test deployment.

Additional disposable-project sequence on 2026-09-28: while project
`prj_wkk5IA0iS8cTKKuaTQoNbxYncCFw` was paused, a new synthetic Production
deployment became externally reachable (HTTP 200) before the explicit
unpause. The project was restored to HTTP 200 with synthetic content; the live
TracePoint project was unchanged. Consequently, **pause alone is not a safe
barrier during a fresh rollback deployment**. The pre-authority abort now
requires an independently active exact-project `Environment Equals Production
→ Deny` WAF rule before installing the rollback key. It reattests that rule
and requires external 403 after the new deployment reaches READY, while the
Supabase source fence, Auth/Storage controls, and public ALB maintenance stay
active. Remove this temporary rule only after source restoration and
single-authority write/read-back pass. The Production WAF predicate/inverse
was previously proven on the disposable project; no live rule has been
published at this checkpoint.

Follow-up disposable proof: an API-created, active `Environment Equals
Production → Deny` rule returned external HTTP 403. A fresh synthetic
Production deployment `dpl_9eThuirdpARJEf7BZVvseLSFNphZ` then reached
READY, but the origin still returned HTTP 403. Removing only that rule
restored external HTTP 200. A subsequent read-only rule inventory showed
zero remaining disposable rules. This proves the additional barrier covers
the previously discovered paused-redeployment gap. The exact live-project
control is packaged in `scripts/manage-production-vercel-cutover-deny.mjs`;
its read-only check found zero live cutover rules. No live rule has been
enabled. The prepared abort script now accepts external 403 or 503 before
redeployment only while that exact Production deny is independently attested,
and requires external 403 after the new deployment reaches READY.

Rollback task correction: the currently running public revision 4 image is
not pullable for a fresh ECS task. The source-restore script now attests and
starts the already prepared `tracepoint-production-bridge-rollback-20260926:1`
task definition, pinned to digest
`sha256:e7f6cf81fd748b60450b2e4c6ee07b53dd8fbceaf5460a4e9973bd4c2534d9ce`.
The ECR scan is COMPLETE with zero findings; the script verifies that the
rebuilt task has the same execution/task roles and container configuration
as live revision 4 apart from its image, waits for ECS stability, and requires
one running task. It also attests the separate exact Production Vercel
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` variable and, during abort only under
active deny, sets it to the modern key already in the pinned bridge secret
before creating the fresh Production deployment. The Vercel sensitive value
is non-readable, so its preexisting type is not assumed. This was checked
read-only against the live project; no Production variable or service changed.
