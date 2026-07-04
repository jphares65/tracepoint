# Move Import Wizard Under Settings

This package moves the Basic Import Wizard from a standalone operational route to a Settings sub-route.

## Adds

- `/settings/import-export`

## Changes

- `/import` now redirects to `/settings/import-export`
- The wizard uses `TracePointShell activePage="Settings"` so the Settings navigation context remains active.

## Notes

This does not add a sidebar item. The Import/Export area should remain an administrative settings function.

After install, open:

`/settings/import-export`

A future small patch can add a visible card/link inside the Settings landing page if needed.
