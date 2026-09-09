# Migration lineage gate before main integration

> Completed by the final reconciled release. Main `d31be2f` was merged at
> `f721088`; production-applied identifiers were preserved, historical staging
> collisions became upgrade fixtures, and unique forward migrations
> `202609060002` through `202609060006` reconcile both histories. Clean bootstrap
> plus production and staging upgrade paths pass with 73 migrations. See
> `aws-final-staging-release-20260906.md` for current evidence. The material below
> records the pre-integration gate and is retained for provenance.

The new comparison reads exact Git migration blobs from origin/main and the isolated AWS HEAD. It reports same-version SQL collisions, branch-only versions, unmatched ledger entries, differing applied-statement hashes and missing applied SQL evidence. File equality uses raw SHA-256 bytes; even comment/line-ending changes remain distinct. Ledger statements use a separately identified JSON-array hash and are never compared as though they were source-file hashes.

Six focused tests pass, including same-version/different-SQL collisions already marked applied on both sides, identical source files with conflicting ledger contents, absent statements, duplicate identifiers and unique forward migrations. Changed-file lint passed. The tool never executes SQL or authorizes deployment.

The pre-hotfix snapshot has 56 identical source migrations and 11 AWS-only migrations. No pending worktree was inspected. Main is still e33e4a4 in that snapshot, so absence of source collisions does not clear the announced unpublished hotfix risk. Neither live ledger was queried while the other session was active. safeToIntegrate remains false.

After the hotfix session has completed and the final main deployment is stable, collect only migration metadata from each explicitly gated Supabase project into local review inputs, then run:

    node scripts/compare-migration-lineages.mjs --production-ledger <production-metadata.json> --staging-ledger <staging-metadata.json> --output <review.json>

Each input row has version and statements (an array, or null if unavailable). Do not supply customer rows. Missing historical statements require explicit provenance/schema reconciliation evidence; never fill them with repository SQL and claim they were applied.

For collisions, retain production-applied identifiers and the historical staging ledger provenance. Use new unique forward-only reconciliation migrations, preserve both original SQL contents as upgrade fixtures, and prove clean bootstrap plus both historical upgrade paths. Do not rename a production-applied identifier, rewrite an applied migration, mark different SQL equivalent, or repair ledger rows merely to silence the gate. No such reconciliation is attempted before the final hotfix source and both ledgers are available.
