# Live storage migration rehearsal

Run 82ed1c8d-43f7-4775-85c0-9276a5ff27bc completed against isolated staging Supabase and private staging S3. Two generated objects (one attachment and one department patch) were inventoried, copied through the actual reconciliation command, downloaded and SHA-256 checked. A repeated copy created no additional versions and retained the same manifest. The rehearsal removed only the exact newly created S3 version IDs, verified destination absence and unchanged source bytes, then copied again and reconciled the restored destination.

Cleanup verified removal of both generated Supabase source objects, every S3 fixture version/delete marker, all three disposable users and both departments. No production objects were inspected or copied. Existing objects are never overwritten. Destination downloads now reject missing/oversized content lengths before buffering.

Repeat with node --import tsx scripts/run-disposable-staging-acceptance.mjs --execute --fixtures-only --storage-migration. This proves live provider transfer, idempotency and version-scoped rollback using generated staging data. It does not mean production storage or existing customer attachments have migrated; production inventory, transfer authorization and reconciliation remain cutover gates.
