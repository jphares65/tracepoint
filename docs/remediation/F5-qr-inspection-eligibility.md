# Remediation F5: QR vehicle decisions use the inspection-eligibility rule

Base: `claude/integration-defects-20261020` (after F2 and F4).

## Defects

| ID | Defect | Fix |
|---|---|---|
| NEW-F5-A (High, new) | `qrDecision` allowed a vehicle only when `enabledFeatures` included `"fleet"`. The feature catalog has no `fleet` code: Fleet is gated by permissions and has no module entitlement. So **every vehicle QR scan returned `denied` for every user**. The existing test hid this by passing a synthetic `"fleet"` feature. | The nonexistent feature requirement is removed. |
| F2 follow-up | The vehicle QR decision used its own permission list (`perform_fleet_inspections`, `view_fleet`, `manage_fleet`), which disagreed with F2's eligibility rule. An officer eligible only through a configured inspection role got `denied`. A `view_fleet` viewer outside the configured roles was offered an inspection that the API and the database then refused. | The route resolves `vehicleInspectionEligible` with the same rule as the inspection API and the database. On AWS-native it calls 045's `can_submit_fleet_inspection` (authoritative, independent of whether RLS lets the caller read `fleet_rules`). In bridge mode it uses the app-side `canSubmitFleetInspection` with the agency's `inspection_role_codes`. Bridge-mode vehicle visibility (F4) also counts eligible inspectors. |

## Verification

- `mobile-workflows.test.ts` has two new tests. They use only real catalog features, plus role-only eligibility and a viewer who is not eligible.
- Before the fix, 2 of 12 tests fail; after it, 12/12 pass.
- `tsc` is clean.
- 045's SQL suite in the validator covers `can_submit_fleet_inspection` itself.

## Staging

Extend S4. An inspector scans a vehicle label and gets `vehicle_inspection` `allowed:true`. An officer who is eligible only through a configured inspection role gets the same result. A `view_fleet` viewer outside the configured roles gets `denied`.

## Rollback

Revert the commit. There is no schema change.
