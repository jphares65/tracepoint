# Source credential epoch: controlled rehearsal and production binding

Status: **PAID REHEARSAL PASSED; NO PRODUCTION CONTROL ACTIVATED.** The
versioned paid-project evidence, including the accidental publishable-key
replacement and bounded rollback proof, is in
`docs/paid-source-credential-epoch-proof-20260928.md`.

The live source is Supabase project `izlkwggluhlhzlumtzes`. The production
migration REST secret in AWS account `193644343389` contains a modern
`sb_secret` credential for that exact project. The live Dashboard shows one
modern secret key named `default` and active legacy JWT-based keys. The paid
rehearsal project is `reukdouvpshshvqnzsgw`; its existing AWS rehearsal
secret is modern, and its Dashboard currently shows two existing modern
secret keys. Secret values are not part of this document or test output.

## Trust boundary

The new capture key is elevated. It is not intrinsically read-only; only the
exact pinned CodeBuild capture program, its read-path allowlist, IAM access
to the Secrets Manager version, and operator discipline make its use
read-only. The rollback key must not appear in any running application,
worker, build environment, or public bundle before an abort. The old epoch
includes **all** older modern secret keys that may authorize writes and the
active legacy `service_role` path. Retiring only one of several elevated
credentials does not establish a fence.

## Paid-project gate

1. Attest project, key names/types/count, source catalog fingerprint, the
   exact synthetic tenant and row, existing fence state, and AWS account.
   Save the two new modern keys only in separate exact-project Secrets
   Manager entries:
   `tracepoint/production/migration/source-rehearsal-epoch-capture-20260927`
   and `tracepoint/production/migration/source-rehearsal-epoch-rollback-20260927`.
   Verify all three known key values are distinct without printing them.
2. With the fence off, repeat representative old-key application, Auth,
   Storage, and service-role positives using synthetic paid-project data.
   Verify the new capture key can perform the bounded read set. Leave the
   rollback key undistributed.
3. Activate the already-proven composite controls: maintenance barrier or
   attested absence of a paid-project public app; stop known writers;
   disable new Auth sign-in and drain/revoke existing sessions; enable the
   public and Storage fence layers; pause schedules; disable S3 protocol
   where applicable; disable legacy JWT-based API keys. Verify each control
   and authoritative before-state before key retirement.
4. Retire **both** pre-existing modern paid-project secret keys only after
   steps 1-3 pass and the rollback key is recoverable. Modern key deletion
   is irreversible; it is never the reversal operation. Check that only
   the two new purpose-named modern keys remain and the legacy elevated
   path is disabled. Run the exact old-key and simulated unknown-holder
   negative probe. A non-401/403 response fails closed. Require unchanged
   authoritative state through the new capture key.
5. Run immutable A and B captures with the capture key only, separated by
   the bounded quiet interval. Require the versioned canonical comparator
   to report zero unexplained relational, identity, membership, and object
   delta. Pin the capture-key fingerprint, artifact keys, S3 VersionIds,
   hashes, and fence attestation; do not log row contents or credentials.
6. Rehearse abort: install the rollback key into the exact known legacy
   application and background components, restore the reversible fence
   controls, and prove representative application, Auth, Storage, and
   service/backend writes plus read-back. Keep deleted keys deleted.
   The legacy JWT keys should remain disabled unless a proven legacy
   `anon` dependency requires a separately reviewed replacement path.
   Confirm Supabase is again the sole writer and no AWS-only customer write
   occurred.

## Production precheck and gate

Read-only precheck must bind the live `default` modern key to the exact
stored production credential without exposing it, enumerate any other
current elevated key records, and verify two new purpose-named production
keys can be created and stored separately. The production capture task must
use **only** the new capture secret version. No regular runtime may read it.
The rollback secret must remain inaccessible to running writers until an
abort. Verify exact ECS/Vercel/background configuration-replacement
commands, legacy JWT-key handling, Auth session drain, Storage controls,
S3-key absence, immutable A/B tooling, comparator, and inverse sequence.
The old-key delete command must identify an exact key ID/name and must not
run from a stale dashboard row or against another project. Unknown holders
of that exact retired credential cease to be a gate only after the direct
old-key negatives pass; other credentials and direct database writers remain
separate gates.

No production maintenance, source freeze, key deletion, capture, import,
worker repoint, DNS change, or authority switch is authorized by this
document alone. Every existing cutover stop/abort gate remains in force.
