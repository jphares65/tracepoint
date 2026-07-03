# TracePoint Pilot Personnel Bridge

This package replaces the pilot mock personnel source with live Supabase department memberships.

## Adds

- `/api/pilot/personnel`
- Range Days roster and instructor selectors now use live department personnel.
- Qualification History uses live department personnel.
- Performance Summary / Analytics / Training Alerts use live personnel labels when generating summaries and alerts.
- Existing mock IDs in the pilot workspace are remapped to live personnel when Range Days loads.

## SQL

No SQL required. This uses existing tables:

- `profiles`
- `department_memberships`
- `department_membership_roles`

## Notes

This is a quick bridge. The later agency-ready version should use a true personnel/officers table so officers can exist even if they do not have login accounts.
