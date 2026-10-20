# Defect stage ledger

Updated 2026-10-20. Candidate staging code commit: `8574db3` on `claude/integration-defects-20261020`. Every defect moves through four separate stages:

| Stage | Meaning |
|---|---|
| **Found** | Evidence in the reconciliation (R2–R7) or a batch record |
| **Fixed in code** | Merged into `claude/integration-defects-20261020` and CI-green (or on a named branch) |
| **Validated in staging** | The staging S-step "after" result is recorded (`docs/remediation/STAGING-VERIFICATION.md` §6 on the integration branch) |
| **Confirmed in production** | Post-deployment check, after separate production authorization |

**No defect is beyond "Fixed in code" yet.** Nothing has been deployed to staging or production.

| Defect | Severity | Found | Fixed in code (branch → integration) | Staging step | Validated in staging | Confirmed in production |
|---|---|---|---|---|---|---|
| ARM-02, NEW-ARM-C, EQP-09, NEW-ADM-G (bootstrap/schema/CI) | High/Critical | R2, R5, R6 | B0 | G1/G2 | — | — |
| NEW-ADM-A first sign-in | Critical | R7 T9 | B1 | S1 | — | — |
| NEW-ADM-D, NEW-ADM-E, ADM-03, 42702 lifecycle bug | High/Med | R6, B1 | B1 | S1, S13 | — | — |
| ADM-04 re-import roles/status | High | R6 | B1a, F1 | S13 | — | — |
| F1: password min 14, blank import fields, Officer not re-added, admin-only lifecycle | High | F1 | F1 | S13, S14 | — | — |
| NEW-01 field writes (inspector, manager) | Critical | R7 T1/T2 | B2 | S2 | — | — |
| EQP-06 self custody | High | R7 T3 | B2 | S3 | — | — |
| NEW-ARM-A ammunition 500 | High | R2 | B2 | S8 | — | — |
| NEW-ADM-C entitlements | High | R7 T4 | B2 | S7 | — | — |
| RNG-01, RNG-03, RNG-04 (confirm), RNG-08, RNG-11, RNG-13, RNG-22, RNG-23 | Critical/High | R3 (executed) | B3 | S5 | — | — |
| FLT-01, FLT-02, FLT-08, FLT-09 | Critical/High | R5 (executed) | B4 | S2, S11 | — | — |
| Audit failure preserves safety status; audit outbox | High | Owner directive | B4, F3 | S11 | — | — |
| Critical hold: survives work-order closure; settings-independent; no clearance while a critical work order is open; conservative 046 baseline | Critical | Owner directive | F3, F6a | S12 | — | — |
| NEW-02 / NEW-ARM-B, FLT-04 / ARM-01 (server) QR | High | R2, R5 (executed) | B5 | S4 | — | — |
| QR disclosure (bridge), duplicates, custody | Med/High | F4, F6b | F4, F6b | S4 | — | — |
| NEW-F5-A vehicle QR always denied | High | F5 | F5 | S4 | — | — |
| Inspection eligibility, cost hiding, issue reporting | High | F2 | F2 | S15, S16 | — | — |
| **DC date contract** (false "expired", off-duty approvals blocked, equipment 500) | **Critical** | B6 (executed) | DC; hotfix candidate `claude/hotfix-date-contract-candidate` | S17 | — | — (**likely live in production**) |
| TRN-26, RNG-28 training visibility | High | R7 T8 | TV | S18 | — | — |
| EQP-01, EQP-04, EQP-12, ARM-08 (display) separated holder | Critical/High | R5, R2 | B9 | S19 | — | — |
| TRN-08, TRN-01, TRN-10, TRN-13, TRN-16, TRN-19, TRN-35 notifications | Critical/Med | R4 | B6, separate branch, **not in integration** | (S6, after infrastructure authorization) | — | — |
| DC2 timestamp contract (timestamptz/timestamp/interval arrive as Date/objects: empty dashboard training lists, blank audit times, custody history order, false range-save 409s) | High | DC inventory, DC2 matrix | DC2 (no migration); recommended for the hotfix candidate, subject to S24 | S24 | — | — (**likely live in production**) |
| B8a: forgeable rifle history (052 as first written), non-atomic firearm status/history, archive ordering, "Unknown User", off-duty inspector 404, rifle reviewer resolution | High/Med | Owner review of B8 | B8a (052 edited in place, 053) | S22a | — | — |
| ADM-07a Assign Password marked email verified without proof; ADM-07b remedy messages | High/Low | ADM-07 trace | ADM-07 (no migration) | S23-3 (revised) | — | — |
| ADM-07c invited users who signed in cannot self-reset | Medium | ADM-07 trace | **Owner decision** after S23-3 (revised) step 2 | — | — | — |
| B7 training records (TRN-02/03/04/11/12/18/27/29/30) | High/Med | R4 | B7 (050) | S20 | — | — |
| B10 qualification and range roles (RNG-07/09/10/12/14/15/24) | High/Med | R3 | B10 (051) | S21 (run the qualification-status diff report first) | — | — |
| B8 armory integrity (ARM-06/11/13/16/17/21/22/23/26/28/29/33), plus second-person certification and rifle history write on AWS (new) | High/Med | R2, B8 | B8 (052) | S22 | — | — |
| B11 admin correctness (ADM-06/08/10/19/20/23/25/30/32; ADM-07 and ADM-02 verified only) | High/Med | R6 | B11 (no migration) | S23 | — | — |

**Superseded or not applicable:**

- ARM-04 is corrected on AWS-native by `database/aws/017`. It still needs verification that the Supabase projects are retired.
- ADM-28 does not apply under Cognito.
