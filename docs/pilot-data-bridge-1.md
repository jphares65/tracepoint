# TracePoint Pilot Data Bridge 1

This package moves the current Range & Training workspace from browser-only localStorage into Supabase while preserving the existing working UI.

## Why this bridge exists

The current Range & Training page already contains a large working pilot workflow:

- range-day planning
- drill library
- selected drills
- rosters
- batch scoring
- qualification scoring
- malfunctions
- AAR notes

Rewriting all of that directly into normalized database tables in one pass would be risky. This package creates a safe first pilot step:

```text
Current working UI → Supabase-backed department workspace → Qualification History / Analytics inputs
```

## What is saved

The Supabase table stores the existing workspace object:

- `rangeDays`
- `drillLibrary`
- `rangeDayDrills`
- `rangeRoster`
- `results`
- `malfunctions`

## What this unlocks

- Range data survives browser/device changes.
- Qualification History can load the same Supabase-backed workspace.
- Readington can start entering real pilot data without being trapped in one browser.
- Later packages can normalize this workspace into `range_days`, `range_day_drills`, `drill_run_results`, and `qualification_results`.

## Install order

1. Run `docs/pilot-range-workspace.sql` in Supabase SQL Editor.
2. Install the code package.
3. Build.
4. Start local dev.
5. Open Range & Training and make a test range-day/scoring change.
6. Refresh and open Qualification History to confirm it sees the same data.
