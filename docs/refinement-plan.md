# TracePoint Refinement Plan

Current phase: pilot refinement / hardening.

## Main Objective

Make the existing feature set clean, obvious, reliable, and credible enough for a Readington internal pilot.

## Do Not Start Yet

Avoid new major modules until the pilot checklist is completed.

Deferred work examples:

- Full normalized ammo schema
- Full Excel import engine
- Full reporting center
- Full global theme system
- External agency onboarding automation
- Advanced forecasting
- Public marketing polish

## Refinement Order

1. Run the Readington Pilot QA Checklist.
2. Fix blocking build/deployment issues.
3. Fix confusing navigation or hidden routes.
4. Clean UI consistency page by page.
5. Remove confusing pilot/dev language from user-facing areas.
6. Test role-based access with multiple user types.
7. Clean demo/test data.
8. Prepare one controlled Readington pilot dataset.
9. Run the complete pilot acceptance test.
10. Resume feature expansion only after pilot flow is stable.

## Definition of Done

TracePoint is internally pilot-ready when:

- Local and Vercel builds pass.
- Core modules persist to Supabase.
- Real personnel can be used in workflows.
- Firearms and ammunition records persist.
- Range results flow to Qualifications, Analytics, Alerts, and Remediations.
- Permissions prevent low-level users from seeing sensitive pages.
- A non-developer user can complete the pilot acceptance flow without help.
