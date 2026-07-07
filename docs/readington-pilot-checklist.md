# TracePoint Readington Pilot QA Checklist

Purpose: validate TracePoint as an internal Readington pilot before adding more major features.

## Pilot Rule

Do not add new major features until this checklist has been tested end-to-end with clean pilot data.

## 1. Deployment / Build Check

- [ ] Local build passes with `npm run build`
- [ ] Git working tree is clean after commit/push
- [ ] Vercel deployment succeeds
- [ ] Vercel deployment uses the latest commit
- [ ] `/login` works
- [ ] Admin user can access Dashboard, Armory, Range Days, Analytics, Training Alerts, Settings
- [ ] Unauthorized or low-level user cannot access restricted modules

## 2. Settings / Agency Setup

- [ ] Agency name displays correctly
- [ ] Agency short name displays correctly
- [ ] User role displays correctly
- [ ] Users page lists active department users
- [ ] Invite/password flow works
- [ ] Import / Export is visible under Settings
- [ ] `/import` redirects to `/settings/import-export`
- [ ] Branding/appearance controls do not break page layout
- [ ] No abandoned or confusing settings cards remain

## 3. Personnel Bridge

- [ ] `/api/pilot/personnel` returns current department personnel
- [ ] Real personnel appear in Range Days roster workflow
- [ ] Real personnel names carry into Qualification History
- [ ] Real personnel names carry into Analytics
- [ ] Real personnel names carry into Training Alerts
- [ ] Remediation records preserve the correct officer name
- [ ] Fake/mock officers are removed or clearly isolated from pilot data

## 4. Import Wizard

Location: `/settings/import-export`

### Firearms Import

- [ ] Upload firearm CSV
- [ ] Headers auto-map correctly
- [ ] Manual mapping changes work
- [ ] Preview table displays mapped data
- [ ] Required-field validation works
- [ ] Duplicate warnings appear when expected
- [ ] Import report displays created/skipped/failed counts
- [ ] Imported firearms appear in Armory
- [ ] Imported firearms persist after refresh
- [ ] Imported firearms appear on Vercel after deploy

### Personnel Preview

- [ ] Personnel CSV uploads
- [ ] Personnel fields auto-map
- [ ] Required-field validation works
- [ ] Preview-only status is clearly understandable
- [ ] No user expects personnel preview to import yet

### Qualification History Preview

- [ ] Qualification CSV uploads
- [ ] Qualification fields auto-map
- [ ] Score/date/course validation works
- [ ] Preview-only status is clearly understandable

## 5. Armory / Firearms Inventory

Location: `/firearms`

- [ ] Firearms list loads from Supabase
- [ ] Add firearm works
- [ ] Added firearm persists after refresh
- [ ] Imported firearm appears correctly
- [ ] Search works
- [ ] Status filter works
- [ ] Selected firearm detail panel is clear
- [ ] Assignment workflow works
- [ ] Assignment persists after refresh
- [ ] Return workflow works
- [ ] Return persists after refresh
- [ ] Status update works
- [ ] Status update persists after refresh
- [ ] Maintenance/inspection language is clear
- [ ] Ammunition card is visible and opens `/firearms/ammunition`
- [ ] Page remains responsive on phone/tablet/large monitor

## 6. Armory / Ammunition

Location: `/firearms/ammunition`

### Duty Ammunition

- [ ] Add duty ammo lot
- [ ] Duty lot persists after refresh
- [ ] Recall/hold flag displays correctly
- [ ] Issue duty ammo to officer
- [ ] Quantity on hand decreases correctly
- [ ] Issue history appears under the lot
- [ ] Issue history persists after refresh
- [ ] Replacement due date is understandable

### Training Ammunition

- [ ] Add training ammo lot
- [ ] Training lot persists after refresh
- [ ] Low-stock threshold displays correctly
- [ ] Issue ammo to range day
- [ ] Issued / consumed / returned logic works
- [ ] Quantity on hand decreases by issued minus returned
- [ ] Recent range usage displays correctly
- [ ] Recent range usage persists after refresh
- [ ] Low-stock indicator triggers correctly

## 7. Range & Training

Location: `/range-days`

- [ ] Range Days page loads without mock-data confusion
- [ ] Range day workspace opens clearly
- [ ] Roster section shows real personnel
- [ ] Officer can be rostered
- [ ] Firearm association is understandable
- [ ] Drill/qualification entry is easy to find
- [ ] Qualification result can be entered
- [ ] Drill result can be entered
- [ ] Scores save to Supabase pilot workspace
- [ ] Refresh preserves entries
- [ ] Workflow is usable on laptop
- [ ] Workflow is usable on tablet/iPad size
- [ ] Workflow does not require jumping between too many screens

## 8. Qualification History

Location: `/qualifications`

- [ ] Qualification History reads saved range/qualification data
- [ ] Real officer names appear
- [ ] Pass/fail status appears correctly
- [ ] Score display is understandable
- [ ] Date/course information is clear
- [ ] Filters/search work if present
- [ ] No unrelated mock records appear after pilot data is entered

## 9. Analytics

Location: `/analytics`

- [ ] Analytics reads live pilot performance data
- [ ] Qualification trends are separate from drill trends
- [ ] Firearm readiness is not mixed into officer-performance analytics
- [ ] Real officer names appear
- [ ] Failed/low scores generate meaningful analytics
- [ ] Analytics page is not overcrowded
- [ ] Empty state is understandable when little data exists
- [ ] Data matches Range Days/Qualifications records

## 10. Training Alerts

Location: `/training-alerts`

- [ ] Alerts generate from live pilot data
- [ ] Real officer names appear
- [ ] Old demo names do not reappear
- [ ] Alert severity makes sense
- [ ] Alert source is understandable
- [ ] Acknowledge workflow works
- [ ] Create remediation workflow works
- [ ] Assigned remediation changes alert status
- [ ] Refresh preserves alert/remediation relationship
- [ ] Low-level users cannot access Training Alerts

## 11. Remediations

- [ ] Remediation can be created from alert
- [ ] Remediation can be assigned
- [ ] Remediation can be started
- [ ] Remediation note can be added
- [ ] Note persists after refresh
- [ ] Remediation can be completed
- [ ] Escalation/command notification status is understandable
- [ ] Audit trail is preserved
- [ ] Supabase table stores remediation workspace
- [ ] No remediation records are browser-only unless clearly fallback

## 12. Permissions / Role Testing

Test accounts:

- Administrator
- Command Staff
- Instructor / Range Master
- Officer
- Low-level user

### Administrator

- [ ] Can access Settings
- [ ] Can access Import / Export
- [ ] Can access Armory
- [ ] Can access Ammunition
- [ ] Can access Analytics
- [ ] Can access Training Alerts
- [ ] Can manage users/invites

### Command Staff

- [ ] Can access command-appropriate analytics/alerts
- [ ] Cannot access unnecessary system administration unless assigned

### Instructor / Range Master

- [ ] Can access Range Days
- [ ] Can enter scores
- [ ] Can see appropriate training alerts/remediations
- [ ] Cannot access system admin unless assigned

### Officer / Low-Level User

- [ ] Cannot access Settings
- [ ] Cannot access Training Alerts
- [ ] Cannot access sensitive analytics unless intended
- [ ] Cannot manage users
- [ ] Cannot import/export agency data

## 13. UI / Responsiveness

Test on:

- Phone
- Tablet/iPad
- Standard desktop monitor
- 36-inch curved monitor

- [ ] Dashboard spacing works on wide monitor
- [ ] Sidebar/menu spacing is reasonable
- [ ] Cards do not stay too narrow on large screens
- [ ] Tables scroll cleanly on small screens
- [ ] Forms are usable on mobile/tablet
- [ ] No page has excessive blank space
- [ ] No page uses inconsistent light/dark styling accidentally
- [ ] Page headers follow consistent structure
- [ ] Success/error messages are readable

## 14. Demo Data Cleanup

Before showing broadly:

- [ ] Remove unnecessary TEST officers or clearly label them as test accounts
- [ ] Remove test firearms imported from CSV
- [ ] Remove test ammo lots
- [ ] Remove old localStorage records if they cause confusion
- [ ] Confirm Vercel data matches intended demo environment
- [ ] Prepare a clean sample dataset if real data is not ready

## 15. Pilot Acceptance Test

The pilot is ready for internal Readington testing when this complete scenario works:

1. Admin logs in.
2. Admin imports or creates firearms.
3. Admin assigns a firearm to an officer.
4. Admin adds duty and training ammo lots.
5. Admin records training ammo issue/consumption.
6. Range staff creates or opens a range day.
7. Range staff rosters a real officer.
8. Range staff enters qualification/drill results.
9. Qualification History reflects the result.
10. Analytics reflects the performance trend.
11. Training Alert appears for a failed/weak result.
12. Instructor creates remediation.
13. Instructor adds notes and completes remediation.
14. Refreshing the app preserves all records.
15. Restricted user cannot access sensitive modules.

Pilot-ready target:

`A real Readington user can complete this flow without developer assistance.`
