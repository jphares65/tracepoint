# Final importer acceptance classification (2026-09-28)

This classifies the *importer* root only. It does not waive source-writer controls, maintenance, authentication, or any other independent cutover gate. The production target has not been imported and Supabase remains authoritative. The owner subsequently approved omitting the two exact agency patch assets, with destination `departments.patch_url = NULL`; all other objects remain in scope.

| Acceptance item | Class | Current evidence / disposition |
| --- | --- | --- |
| Exact capture B VersionId, byte hash, canonical master hash, and quiescent A/B pair | CUTOVER-CRITICAL | Enforced in `run-production-final-atomic-import.mjs` and `production-final-atomic-import-core.mjs`; actual frozen production pair exists only during cutover. |
| Exact final RDS identity, TLS, clean baseline, and 99-migration lineage | CUTOVER-CRITICAL | Enforced before mutation. The isolated proof clone was attested; final-target mutation is not authorized by proof-clone evidence. |
| Variable frozen relational/identity/membership counts and complete 90-relation apply | CUTOVER-CRITICAL | Code supports variable counts; integrated paid-artifact-to-clone apply has not completed. |
| Identity, membership, role, audit/history, and every relation's semantic reconciliation | CUTOVER-CRITICAL | In-transaction checks exist; integrated paid-artifact-to-clone reconciliation has not completed. |
| Foreign keys, **in-scope** object-reference existence, object byte/hash/metadata parity, and tenant ownership | CUTOVER-CRITICAL | The two exact patch assets are excluded by the owner-approved projection; missing, corrupt, or cross-tenant *in-scope* objects remain blocking. Integrated proof is incomplete. |
| Rollback on any apply/reconciliation failure and clean baseline afterward | CUTOVER-CRITICAL | Mocked tests exist; isolated PostgreSQL forced-rollback test has not passed because fixture adaptation fails before apply. |
| Commit-outcome verification, ambiguous-commit handling, and deterministic rerun/idempotency | CUTOVER-CRITICAL | Transaction boundary has fail-closed unknown-outcome behavior; integrated PostgreSQL commit/rerun proof remains incomplete. |
| Two exact agency patch objects and their image presentation | DEFERRABLE | Do not copy these assets, set only their destination patch references to NULL, and re-upload manually after cutover. The source artifact retains the prior references for audit. The approved IDs/keys are pinned in `production-final-patch-omission.mjs`; no other object qualifies. |

The prior isolated-proof failure was `DEPARTMENT_PATCH_OBJECT_PATH_INVALID`: the paid-rehearsal fixture's patch path did not match the production delivery route's required shape. The owner-approved projection now validates the exact pinned source object and tenant, then omits that patch from the target. The production route is unchanged. Full apply, forced rollback, commit, post-commit verification, and rerun on the private proof target must still pass before importer evidence is set true.

Post-cutover remediation: manually re-upload each agency image through the normal application workflow. The prior source references below came from the immutable historical source artifact with master SHA-256 `8b01ea2a57a650b10d126160c5d171fecf1e98f1e07a9fa720e97e600d8d6d57`; final capture B must still match these exact IDs/keys or fail closed.

| Agency/department ID | Prior source patch reference | Required AWS destination state |
| --- | --- | --- |
| `1d0e2994-4224-4237-8328-71020ba20027` | `https://izlkwggluhlhzlumtzes.supabase.co/storage/v1/object/public/department-assets/1d0e2994-4224-4237-8328-71020ba20027/patch-1787431778595.jpg` | `patch_url = NULL`; manual re-upload |
| `d01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0` | `https://izlkwggluhlhzlumtzes.supabase.co/storage/v1/object/public/department-assets/d01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0/patch-1782439034425.png` | `patch_url = NULL`; manual re-upload |

This exception cannot defer missing or cross-tenant in-scope objects, non-patch attachments, or unexplained relational differences. Known excluded objects already present in the private target bucket are counted separately; no new excluded object is copied and no database reference is retained.
