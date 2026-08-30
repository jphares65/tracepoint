# Data validation plan

## Layers

1. **Schema:** normalized catalog diff for columns/defaults/nullability, PK/FK/
   unique/check constraints, indexes/predicates, views, functions/signatures,
   triggers/order, extensions, grants and RLS policies.
2. **Counts:** exact table counts while writes are frozen; counts by
   `department_id`, status and date partitions for large/critical tables.
3. **Content:** deterministic per-table hashes over stable ordered canonical
   columns, excluding known provider timestamps only when documented.
4. **Integrity:** orphan queries for every FK, uniqueness checks, not-null checks,
   valid enum/state transitions and sequence/identity `nextval > max` checks.
5. **Authorization:** matrix of anonymous, member, inactive member, each
   configurable role, department administrator, platform admin and service
   identity against same-agency and other-agency records.
6. **Workflow:** invitation/activation, firearm assignment/inspection, off-duty
   approval, qualification, equipment assignment, training closeout, fleet and
   notification/audit flows.
7. **Storage linkage:** every attachment metadata row maps to one object; every
   migrated object maps to allowed metadata; size/hash/content-type match.

## Evidence format

Store query checksum, source/target engine/version, start/end timestamp, frozen
LSN, expected/actual, discrepancy owner and disposition. Never store row content,
tokens, emails or sensitive object names in general CI logs. Failed validation
is a cutover stop, not a warning.

## Tolerances

Core transactional, authorization, audit and identity data require exact match.
Derived notification/readiness rows may use explicitly approved recomputation,
but inputs and final business results must match. No unexplained tolerance.

## Rollback triggers

Any cross-tenant access, missing audit actor, FK/sequence mismatch, unexpected
count/hash difference, failed restore, connection saturation, or irreconcilable
provider error-contract change stops the rehearsal/cutover.
