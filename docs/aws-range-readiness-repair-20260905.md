# Range workspace readiness repair

The staging bootstrap omitted pilot_range_workspaces, which existing range and Drill Library document routes require. Migration 202609050004 adds that relation with tenant read isolation, server-only writes and audit coverage. It inserts no tenant data. Existing qualification standard relations were verified present.

The bulk workspace PUT previously checked feature entitlement without requiring range-management or scoring permission. The new policy denies ordinary officers, limits scoring-only roles to scoring/malfunction changes, and applies existing locked/scored drill deletion protections to bulk saves. Saved result/malfunction IDs cannot be erased through this route. A compare-and-set update rejects changes made between validation and persistence. This does not claim a complete revision-token protocol for stale browser snapshots.

Local validation: 139 application tests, 11 focused range tests, TypeScript, changed-file lint, Next production build and clean 60-migration bootstrap passed. The bootstrap now exercises workspace tenant read isolation and direct non-manager write denial.

After image deployment and staging migration application, run node scripts/run-disposable-staging-acceptance.mjs --execute --range-documents. Added scenarios create disposable range data through the application, verify locked/scored and bulk-save deletion denial, remove an editable drill, and exercise document upload/view/download/delete, cross-tenant denial, non-manager writes, audit creation and cleanup. Live results are pending.
