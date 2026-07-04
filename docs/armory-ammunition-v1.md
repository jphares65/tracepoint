# TracePoint Armory Ammunition v1

This package adds Ammunition Management as an Armory subpage.

## New route

- `/firearms/ammunition`

## New API route

- `/api/pilot/ammunition`

## New Supabase pilot table

- `public.pilot_ammunition_workspaces`

## Features

### Duty Ammunition

- Add duty ammunition lots
- Track caliber, manufacturer, load, lot number, purchase date, quantity, replacement due date, recall/hold flag, and notes
- Issue duty ammunition to officers
- Preserve issue history inside the pilot workspace

### Training Ammunition

- Add training ammunition lots
- Track caliber, manufacturer, load, lot number, purchase date, quantity, cost per round, low-stock threshold, and notes
- Issue training ammunition to range days
- Track issued, consumed, and returned ammunition
- Show low-stock indicators

## Notes

This is intentionally a Supabase-backed pilot workspace. The next normalized version should use dedicated tables for ammunition lots, duty issues, training issues, recalls, range-day ammunition usage, purchase history, and audit events.
