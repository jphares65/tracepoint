# Release candidate versus the deployed staging baseline (owner item 4)

Read-only. Checked on 2026-10-22 from GitHub and the public HTTP surface. AWS was not checked: the session's AWS credentials are invalid (`InvalidClientTokenId`), so image digests, task definitions and build sources (owner item 3) are still **unverified**.

## 1. What is deployed

| Environment | Source commit served (`?dpl=` = `DEPLOYMENT_VERSION` = `SOURCE_COMMIT`) | On GitHub? |
|---|---|---|
| Production | `5700011cc9ea6cff880bcb7f697423fa7f4fd27c` | **No.** It is not in any of the 83 refs; the commits API returns "No commit found". |
| Staging | `22e543d86dc9709c341010ac883406429b4e55c2` | **No**, same. |

Production serves `/api/mobile/inbox` (added in `555f061`), so it is at least as new as the staging line. The earlier inference that production runs `564ff78` is wrong.

## 2. Candidate lineage

- **RC:** `origin/claude/integration-defects-20261020` @ `5b6cc00`. It is `555f061` (the staging line, `codex/staging-mobile-api-release-20261007`) plus 78 commits, and 0 behind. History is linear: `564ff78` ⊂ `555f061` ⊂ RC.
- **Candidate:** the RC plus UX-RB (`claude/fix-uxrb-release-safety`).
- **Between `555f061` and the RC, no route or page file is added or removed**, only modified (`git diff --name-status`).

## 3. Route surface, staging and production (unauthenticated probe)

- **All `/api/mobile/**` and `/api/auth/**` routes that answer on staging or production exist in the RC.** Fixed-string comparison; the earlier "not in RC" marks came from a regex bracket error.
- **`/api/auth/session/refresh`** returns 401 on both, but so does any unknown `/api/auth/*` path (middleware), so the probe cannot tell whether it is served. The route is not in `564ff78`, `555f061` or the RC, and comes from a September branch (`23b76df`). It is not expected to be deployed.
- **Presigned evidence routes** (`…/evidence/initiate`, `…/confirm`, `…/[evidenceId]`, from `codex/mobile-v1-backend-integration-20260914`) return 404 on both. They are not deployed, so nothing is lost there.

## 4. Pushed work not in the candidate

| Branch | What it changes | Effect of deploying the candidate |
|---|---|---|
| `main` (lease PRs #1–7) and the 2026-10-07 `codex/staging-database-lease-*`, `-native-release-lane-`, `-native-image-tag-contract-` branches | Release tooling, workflows and infrastructure only; no `src/`, `database/`, `package.json` or Dockerfile change. | Nothing in the application image regresses. These are Lane C and stay separate; deployment tooling should come from the reviewed release path, not from the candidate branch. |
| `claude/fix-b6-notification-delivery` | B6 notification delivery; needs infrastructure authorization. | Not included, by design (documented as separate). |
| `claude/hotfix-date-contract-candidate` (`221d209` on `555f061`) | The date-only part of the date contract. | Superseded: the RC contains DC and DC2. |
| `claude/fix-b8a-contract-054` | The deferred `054` migration (Lane B). | Not included, by design. |
| `claude/native-staging-build-20261021`, `claude/staging-preflight-20261020`, `claude/tracepoint-operational-audit-w567t8`, `claude/tracepoint-uiux-audit-q2sbf2` | Documentation only. | Nothing lost. |

## 5. Residual risk (blocker)

The commits actually running, `22e543d` (staging) and `5700011` (production), cannot be compared because they are not on GitHub. **Any change in them that is not in the RC would be removed by deploying the candidate.** This includes local or unpushed fixes, configuration baked into the image, and a different base.

Before deployment, one of these is needed:
1. the owner pushes both commits (or confirms which pushed commit each was built from); or
2. read-only AWS provenance shows each image's source revision, build input and digest (owner item 3, when SSO credentials are refreshed).

Then run `git diff <deployed> <candidate>` and review every change in the candidate's direction.
