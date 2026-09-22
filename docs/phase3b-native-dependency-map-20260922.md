# Phase 3B native-runtime dependency map

Baseline: `fcabd93e74aaacd22bdd1c943175e7565fb7e1d6`. Reference: `1225879`.
This is the complete pre-edit set of 39 files under `src/app` and `src/lib` with a direct `@/lib/supabase` or `@supabase/` import. `B` includes mixed authentication-plus-data callers because their application-data path must be isolated. Native equivalents are reference patterns, not permission to replace current product files wholesale.

| Current file | Class | Native reference / required boundary |
| --- | --- | --- |
| `src/app/activate/page.tsx` | A AUTH ONLY | Native Cognito activation path and runtime dispatch |
| `src/app/auth/callback/route.ts` | A AUTH ONLY | Cognito callback route |
| `src/app/auth/confirm/route.ts` | A AUTH ONLY | Cognito confirmation/session dispatch |
| `src/app/auth/signout/route.ts` | A AUTH ONLY | Cognito logout route |
| `src/app/login/LoginForm.tsx` | A AUTH ONLY | Cognito managed-login browser path |
| `src/app/login/page.tsx` | A AUTH ONLY | Cognito session-aware login page |
| `src/app/auth/setup/page.tsx` | B APPLICATION DATA | Cognito setup plus tenant-bound server access |
| `src/app/api/active-department/route.ts` | B APPLICATION DATA | Native active-department repository and Cognito principal |
| `src/app/api/notifications/email-dispatch/route.ts` | B APPLICATION DATA | PostgreSQL outbox/SES dispatch; shadow suppression required |
| `src/app/api/platform/agencies/route.ts` | B APPLICATION DATA | Native platform administration repository |
| `src/app/api/platform/agency-user-administrator/route.ts` | B APPLICATION DATA | Native platform administration repository |
| `src/app/api/platform/support-mode/route.ts` | B APPLICATION DATA | Native support-mode repository |
| `src/app/api/settings/onboarding/certifications/route.ts` | B APPLICATION DATA | Tenant-bound PostgreSQL onboarding adapter |
| `src/app/api/settings/onboarding/equipment/route.ts` | B APPLICATION DATA | Tenant-bound PostgreSQL onboarding adapter |
| `src/app/api/settings/onboarding/firearms/route.ts` | B APPLICATION DATA | Tenant-bound PostgreSQL onboarding adapter |
| `src/app/api/settings/onboarding/off-duty-firearms/route.ts` | B APPLICATION DATA | Tenant-bound PostgreSQL onboarding adapter |
| `src/app/api/settings/onboarding/personnel-directory/route.ts` | B APPLICATION DATA | Cognito directory plus tenant-bound PostgreSQL |
| `src/app/api/settings/onboarding/personnel/route.ts` | B APPLICATION DATA | Cognito personnel creation plus PostgreSQL |
| `src/app/api/settings/onboarding/qualification-history/route.ts` | B APPLICATION DATA | Tenant-bound PostgreSQL onboarding adapter |
| `src/app/api/settings/users/activation/route.ts` | B APPLICATION DATA | Cognito activation plus PostgreSQL membership |
| `src/app/api/settings/users/invite/route.ts` | B APPLICATION DATA | Cognito invitation plus PostgreSQL membership |
| `src/app/api/settings/users/password-reset/route.ts` | B APPLICATION DATA | Cognito password lifecycle plus PostgreSQL |
| `src/app/components/TracePointShell.tsx` | B APPLICATION DATA | Native appearance server API; keep current shell UI |
| `src/app/components/VisualCustomization.tsx` | B APPLICATION DATA | Native settings/appearance API; keep current editor UI |
| `src/app/page.tsx` | B APPLICATION DATA | Cognito session plus tenant-bound profile/membership reads |
| `src/app/platform/[departmentId]/page.tsx` | B APPLICATION DATA | Native platform administration repository |
| `src/app/platform/layout.tsx` | B APPLICATION DATA | Cognito principal plus platform permission check |
| `src/app/platform/page.tsx` | B APPLICATION DATA | Native platform administration repository |
| `src/app/settings/command-dashboard-analytics/AnalyticsDashboardSettingsPanel.tsx` | B APPLICATION DATA | Native settings-data API; keep current panel UI |
| `src/app/settings/components/RangeQualificationRulesPanel.tsx` | B APPLICATION DATA | Native settings-data API; keep current panel UI |
| `src/app/settings/page.tsx` | B APPLICATION DATA | Native settings browser client/API; keep current settings UI |
| `src/lib/tracepoint/activation.ts` | B APPLICATION DATA | Cognito activation plus tenant-bound PostgreSQL |
| `src/lib/tracepoint/server-access.ts` | B APPLICATION DATA | `server-access-postgres.ts`, Cognito principal, PostgreSQL client |
| `src/app/settings/page.tsx.bak` | E LEGACY/UNUSED | Backup file; must not enter native runtime |
| `src/lib/authentication/server-provider.ts` | E LEGACY/UNUSED | Type-only Supabase import; provider-neutral type in native line |
| `src/lib/supabase/admin.ts` | E LEGACY/UNUSED | Legacy bridge-only module, unreachable in native mode |
| `src/lib/supabase/client.ts` | E LEGACY/UNUSED | Legacy bridge-only module, unreachable in native mode |
| `src/lib/supabase/proxy.ts` | E LEGACY/UNUSED | Legacy bridge-only module, unreachable in native mode |
| `src/lib/supabase/server.ts` | E LEGACY/UNUSED | Legacy bridge-only module, unreachable in native mode |

Counts: A=6, B=27, C STORAGE=0, D REALTIME/OTHER=0, E=6; total=39. Storage selects its provider through `src/lib/storage/object-store.ts` and therefore was not in the direct-import set. Native mode must still prove the Supabase storage adapter unreachable.
