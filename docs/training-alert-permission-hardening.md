# TracePoint Training Alerts Permission Hardening

This package formalizes access control for `/training-alerts`.

## What changes

- Converts `/training-alerts/page.tsx` into a server-protected route.
- Moves the existing UI into `/training-alerts/TrainingAlertsClient.tsx`.
- Checks Supabase permissions before rendering the module.
- Redirects unauthenticated users to `/login`.
- Redirects unauthorized users to `/unauthorized`.
- Adds SQL for formal Training Alert and Remediation permissions.

## New permissions

- `view_training_alerts`
- `manage_training_alerts`
- `create_remediations`
- `manage_remediations`
- `resolve_remediations`
- `view_command_training_alerts`

## Note

The server route protection is the hard gate. Even if someone manually types `/training-alerts`, they must have an approved permission.
