# TracePoint Pilot Remediation Persistence

This package moves the pilot remediation workflow from browser-only localStorage to Supabase.

## Adds

- `public.pilot_remediation_workspaces`
- `/api/pilot/remediations`
- Training Alerts client now loads and saves remediations through Supabase.
- localStorage remains as a fallback cache.

## Pilot loop completed

Trend detected → Training Alert generated → Remediation created → Remediation saved → Outcome recorded
