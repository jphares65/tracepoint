# Defect stage ledger

Updated 2026-10-20. Every defect moves through four separate stages:

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
| DC2 timestamps arrive as Date (dashboard training lists empty) | Medium | DC inventory | **Not fixed** | — | — | — |
| B7 training records (TRN-02/03/04/11/12/18/27/29/30) | High/Med | R4 | In progress | — | — | — |
| B10 qualification and range roles (RNG-07/09/10/12/14/15/24) | High/Med | R3 | In progress | — | — | — |
| B8 armory integrity, B11 admin correctness | High/Med | R2, R6 | Planned | — | — | — |

**Superseded or not applicable:**

- ARM-04 is corrected on AWS-native by `database/aws/017`. It still needs verification that the Supabase projects are retired.
- ADM-28 does not apply under Cognito.
