# Defect remediation status

Updated 2026-10-20. The plan is in [README.md §5](README.md#5-remediation-plan-defects-only).

**What has and hasn't happened:**
- Nothing is deployed.
- No pull requests are open.
- Production is untouched.

**Gates still required before anything ships:**
- staging verification by the owner (§8 runbook);
- explicit production authorization.

## Branches

Every branch is cut from `555f061` (`codex/staging-mobile-api-release-20261007`) through B0. Each one carries its record in `docs/remediation/`.

| Branch | Batch | Defects fixed | Migration | Status |
|---|---|---|---|---|
| `claude/fix-b0-proof-foundation` | B0 proof foundation | NEW-ARM-C, ARM-02 (clean bootstrap), EQP-09, NEW-ADM-G, false-green test files, PR quality gate | 038 | Pushed |
| `claude/fix-b1-account-access` | B1 account access | NEW-ADM-A, NEW-ADM-D, NEW-ADM-E, ADM-03, 42702 bug in `prepare_cognito_membership_operation` (new), Send Activation lookup (new), NEW-ADM-B (partial) | 039 | Pushed |
| `claude/fix-b1a-reimport-safety` (on B1) | B1a re-import safety | ADM-04 | — | Pushed, **ship with B1** |
| `claude/fix-b2-field-write-authorization` | B2 AWS field-write authorization | NEW-01, EQP-06, NEW-ARM-A, NEW-ADM-C; amended for B4 compatibility | 040, 041 | Pushed |
| `claude/fix-b3-range-save-integrity` | B3 range save integrity | RNG-01, RNG-03, RNG-04 (confirmation), RNG-08, RNG-11, RNG-13, RNG-22, RNG-23, hidden save failures | 042 | Pushed |
| `claude/fix-b4-fleet-integrity` | B4 fleet integrity, with the owner-directed audit outbox | FLT-01, FLT-02, FLT-08, FLT-09, FLT-19/20 (partial), list-PATCH NULL write (new), audit failure preserves safety status, odometer correction validation and audit | 043 | Pushed. **Approved for integration and testing only; must follow B2** |
| `claude/fix-b5-qr-resolve` | B5 QR resolve | NEW-02 / NEW-ARM-B, FLT-04 / ARM-01 (server side) | — | Pushed |

## Integration findings (trial merge, scratch only, not pushed)

- **Textual conflicts:** only `scripts/validate-clean-bootstrap.mjs`, where B1, B3 and B4 each add assertions to the AWS stage. The resolution is to keep every assertion.
- **Semantic conflict, already resolved in B2:**
  - B2's fleet guard refused all status changes on a manually overridden vehicle.
  - That would have blocked B4's rule that a critical defect is never masked.
  - B2 now allows exactly Available/Attention → Out of Service (with reason) for field workflows. This is covered by a regression test that fails on the original guard.
- **Overlaps that merge cleanly:**
  - B2 and B5 both change `src/app/api/equipment/custody/route.ts`; they merge cleanly and both tests pass.
  - B4's audit outbox (043) and B2's `audit_events_insert_fleet` (040) coexist. 043 delivers inspection audits through its own function; 040 is still needed for other fleet audits and for the fallback.
- **Combined result** (B0 + B1 + B1a + B2 + B3 + B4 + B5), run locally on a disposable PostgreSQL 16 and the repo test runner:

  | Check | Result |
  |---|---|
  | `tsc --noEmit` | 0 errors |
  | Clean bootstrap and validator (79 Supabase-lineage + 43 AWS migrations, B2 field-write SQL suite, all batch assertions) | Pass |
  | Application tests | 609/613. The 4 failures are the sandbox `xlsx` stub. 14 embedded-PostgreSQL files cannot start PostgreSQL as root here; each batch ran its own against a local server, and they will run in CI. |

## Deployment order (staging first)

1. **Database:** apply `038`→`043` with `migrate-db.ps1 staging -Action status`, then `apply`. Each migration is idempotent.
   - 039 must precede the B1 image.
   - 040/041 must precede or accompany B4.
2. **Image:** one combined image, built from an integration branch the owner approves.
3. **Verify:** run the §8 runbook (S1–S10) before and after, and record the results.
4. **Production:** only with explicit authorization.

## Owner decisions outstanding

| From | Decision |
|---|---|
| B1 | Pick the Cognito password minimum: the staging CDK says 14, while production was hand-patched to 10. Decide whether pending users may activate on their first native-app sign-in. Decide whether platform Send Activation should work outside Support Mode. |
| B1a | Confirm that explicit `Active=No` in a re-import deactivates the member, including Cognito. Decide whether blank badge/rank/unit cells should stop overwriting (separate defect). Decide whether aws-native re-import should stop adding the Officer role (needs a migration). |
| B2 | Who may inspect: the route admits `inspection_role_codes`, and everyone when that list is empty, but the database does not. Confirm inspectors may read work-order costs. Confirm custody lookup of another officer's item returns not found. |
| B3 | The native client must ignore the new `resultRevisions` key and should send `baseUpdatedAt`. Decide whether 042 needs a Supabase-lineage copy. Multi-device merge stays deferred. |
| B4 | Confirm the outbox design deviations 1–4 in its record. A critical inspection whose work order failed holds the vehicle Out of Service until a work order exists or a re-inspection passes. The native client should show the `error` text on a 500. |
| B5 | Decide whether an unauthorized in-agency firearm scan should return `unknown` instead of `denied`. The native client should handle 409 "ambiguous". |
| Plan §6 | The remaining owner-decision items (lockout policy, inert settings, data visibility, and so on). |

## Remaining defect batches (not started)

- **B6** notification delivery: scheduler and proxy allow-list, scheduled generation, stable fingerprints. This needs infrastructure change authorization.
- **B7** training records.
- **B8** armory integrity.
- **B9** equipment holder.
- **B10** qualification computation and range roles.
- **B11** admin correctness, which has the remaining ADM items besides ADM-04.

## Update: integration branch

**Branch:** `claude/integration-defects-20261020`. It contains B0, B1, B1a, B2, B3, B4, B5, F1, F2, F3, F4, F5 and DC, with migrations 038–046. Source commits are listed in `docs/remediation/INTEGRATION.md` on that branch.

**CI:** green on a GitHub runner with the real SheetJS package and PostgreSQL (application tests 676/676 at first integration).

**Staging package:** `docs/remediation/STAGING-VERIFICATION.md`. It covers:

- pre-flight checks;
- migration order and dependencies;
- rollback for each migration and image, including two image-rollback cautions;
- acceptance steps S1–S17;
- an evidence template.

**New defects found during follow-ups, all fixed on the integration branch:**

| ID | Defect |
|---|---|
| DC | AWS-native returned `date` columns as JavaScript `Date` objects, so valid certifications evaluated as **expired**. This is likely live in production if production is AWS-native. |
| NEW-F5-A | Every vehicle QR scan was denied, because the QR decision required a nonexistent `fleet` feature flag. |
| F1 gap | A non-Administrator holding `manage_users` could deactivate an Administrator through import. |

**Kept separate, not in integration:** `claude/fix-b6-notification-delivery` (app-side notification fixes plus the scheduler entry points). It waits for the infrastructure proposal decision (`docs/remediation/B6-infrastructure-proposal.md` on that branch).

**Next:** [plan-b7-b11.md](plan-b7-b11.md).

## Update: B9, B7 and B10 merged

| Batch | Branch @ commit | Migration | Integration CI |
|---|---|---|---|
| TV training visibility | `claude/fix-tv-training-visibility` @ `3f8f5e2` | 048 | Green |
| B9 equipment holder | `claude/fix-b9-separated-custody` @ `330ce20` | 049 | Green |
| B7 training records | `claude/fix-b7-training-records` @ `15867d0` | 050 | Green (run 10) |
| B10 qualification and range roles | `claude/fix-b10-qualification-range-roles` @ `6e43ab4` | 051 | Green (run 11) |
| B8 armory integrity | `claude/fix-b8-armory-integrity` @ `06d397d` | 052 | Green (run 12) |
| B11 admin correctness | `claude/fix-b11-admin-correctness` @ `b8b3475` | — | Green (run 14, integration head `e19e84c`) |

The staging package now covers migrations 038–051 (047 is reserved for B6) and acceptance steps S1–S21. Native contract rows C25–C27 cover B10.

**B10 needs a data-impact step before staging apply:** run `scripts/qualification-status-snapshot.sql` and `scripts/qualification-status-diff.mjs`, and close out completed range days, because passes on open days stop counting.

B8 and B11 are now merged, in that order. The staging package covers migrations 038–052 and steps S1–S23. **All planned batches B0–B11 except B6 are fixed in code. None is validated in staging or confirmed in production.**

Open owner decisions from B8/B11:
- B8: profile name read for `manage_firearms`-only armorers ("Unknown User"); two read-policy gaps (off-duty inspection without review permission; rifle-review permission resolution for non-administrators); review the narrow personal-rifle history INSERT grant in 052.
- B11: ADM-07 `email_verified` for invited users (S23 step 3); bridge-mode member save stays non-atomic; 63 other routes still pass raw error text in some path; 33 armory backup files still to remove.

## Update: owner follow-ups before staging

| Item | Branch @ commit | Migration | Integration CI |
|---|---|---|---|
| ADM-07 invited-user reset | `claude/fix-adm07-invited-reset` @ `9a7a234` | — | Green (run 15) |
| DC2 timestamp contract | `claude/fix-dc2-timestamp-contract` @ `2f4d675` | — | Green (run 16) |
| B8a armory audit history and access | `claude/fix-b8a-armory-access` @ `de82a0d` | 052 (edited in place, unapplied anywhere), 053 | Green (run 18 on `196542a`; run 17 was superseded) |

**Candidate staging code commit:** `8574db3`. Everything after it on the branch is documentation only. The staging package covers the 15 pending migrations 038–046 and 048–053, plus steps S1–S24 with S22a and the revised S23-3. The open information-disclosure items are in [security-backlog.md](security-backlog.md).
