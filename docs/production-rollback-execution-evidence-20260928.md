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
