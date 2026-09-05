# Authenticated staging schema repair

Authenticated testing of image 7635a07 exposed absent feature_catalog and department_features tables and missing department_rules qualification columns despite a matching 58-version ledger. Migration 202609050003 adds the required feature catalog, tenant entitlements, entitlement events, audit triggers, and two rule columns. It enables no existing tenant. Authenticated users receive tenant-scoped read access only; entitlement writes remain server-side behind the existing platform administrator check.

Applied transactionally only to wztqqqashilusoppddxi after exact previous-ledger and absent-table preconditions. Staging now has 59 migrations. Clean standard PostgreSQL bootstrap of all 59 passed. Local and live transaction-rolled-back tenant tests passed, including foreign entitlement read denial and member entitlement write denial.

Disposable browser run 0ded90af-4fe0-443a-b804-6b9ca7dd3fcc passed login, tenant resolution, session persistence, all twelve authenticated page paths, seven JSON reads, foreign tenant cookie rejection, equipment type Add/Edit/Archive/Restore/Remove, logout, and public route checks. Fixture cleanup verified. Remaining workflow coverage is explicitly blocked in the harness and is not counted as complete acceptance.
