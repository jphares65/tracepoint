# Migration-only staging and commit plan

**Prepared only; do not execute.** Final evidence pass completed 2026-08-30.
Use the allowlist in
`docs/aws-migration-file-manifest.md`, verify each path still belongs to the
migration, and stage paths explicitly—never `git add .` or `git add -A`.

Before staging: compare `git status --untracked-files=all` to the manifest;
confirm `src/app/integration-demo/` remains untracked/unstaged; confirm generated
directories are ignored; rerun secret scan/build/synth/lint/diff check; inspect
the cached binary font hashes and OFL; review the full staged diff including
binary list and lockfile.

Proposed commit message:

`feat(aws): add dormant staging migration foundation and runbooks`

Validation summary for the eventual commit body: Next.js production build
passed; targeted ESLint passed with one expected CSS-file warning; CDK TypeScript
build passed; management and non-staging refusal tests passed; verified staging
account `559054714699` synthesis passed; template security assertions passed; OpenAPI
parse passed; migration-only secret scan found no credential signatures; and
`git diff --check` passed. Docker build/scan was not run because Docker is
unavailable and installation is prohibited. A live `cdk diff` remains pending
separately approved least-privilege bootstrap.

Final working-tree comparison: 49 allowlisted paths are present. The only
unallowlisted change is the pre-existing `src/app/integration-demo/page.tsx`,
which must remain unstaged. No generated artifact is tracked or staged.
