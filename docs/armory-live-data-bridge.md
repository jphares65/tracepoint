# TracePoint Armory Live Data Bridge

This package replaces the Armory/Firearms page with a cleaner live-data pilot view that uses the existing Supabase-backed Armory API routes.

## Uses existing routes

- `GET /api/armory/firearms`
- `POST /api/armory/firearms`
- `POST /api/armory/firearms/[firearmId]/assignments`
- `PATCH /api/armory/firearms/[firearmId]/assignments`
- `PATCH /api/armory/firearms/[firearmId]/status`

## Pilot behavior

The page now supports:

- live Supabase firearm inventory
- add firearm
- select firearm
- assign firearm to active department member
- record return
- update condition status
- refresh inventory
- search and status filter

No SQL is included in this package because the underlying Armory tables and API routes already exist in the current project.
