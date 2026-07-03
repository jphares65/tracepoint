# Pilot Data Name Sync Fix

This patch fixes the mismatch where Analytics was reading generated pilot data while Training Alerts still displayed older demo names.

## Changes

- Training Alerts now treats `/api/pilot/performance-summary` as the source of truth when saved pilot workspace data exists.
- Legacy mock alerts for Carter/Reynolds are filtered out of localStorage.
- Existing generated pilot alerts preserve their status, linked remediation ID, and audit log when refreshed.
- Default Training Alert examples now use the same pilot/mock personnel as Range & Training and Analytics:
  - Officer Smith
  - Sgt. Williams
  - Instructor Jones

## Expected result

Analytics and Training Alerts should show the same officer names and the generated concerns should line up.
