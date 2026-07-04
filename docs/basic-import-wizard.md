# TracePoint Basic Import Wizard

This package adds the first Agency Onboarding & Import Wizard scaffold at `/import`.

## Current capability

- Choose import type:
  - Personnel
  - Firearms
  - Qualification History
- Upload CSV
- Auto-map common headers
- Manually adjust field mapping
- Validate required fields
- Detect possible duplicates within the uploaded file
- Preview mapped rows
- Generate an import report

## Live import support

The first live import target is Firearms.

Firearms rows are imported through the existing live Armory API:

- `POST /api/armory/firearms`

Personnel and Qualification History are currently preview/report only because the normalized personnel import and historical qualification import targets still need to be finalized.

## Notes

This is intentionally a pilot scaffold, not the full final white-glove onboarding center.
Future phases should add:

- Excel `.xlsx` support
- saved mappings by agency
- duplicate checks against Supabase
- update/skip/create choices
- rollback records
- normalized personnel import
- normalized qualification history import
- maintenance and inspection imports
