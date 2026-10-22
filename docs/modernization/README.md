# TracePoint platform modernization

The program that turns TracePoint into one cohesive, commercial-grade product, following the approved
[Unified UI/UX Modernization Blueprint v2](sources/blueprint-v2/index.html). This folder is its single
source of truth.

| Document | What it is |
|---|---|
| [REGISTER.md](REGISTER.md) | Every requirement, generated from [`register/*.json`](register/). Rules: [`register/SCHEMA.md`](register/SCHEMA.md). |
| [COMPLETION-MATRIX.md](COMPLETION-MATRIX.md) | Module-by-module completion, generated. |
| [design-system/TOKENS.md](design-system/TOKENS.md) | Color, status, type, spacing and radius tokens. |
| [design-system/COMPONENTS.md](design-system/COMPONENTS.md) | Shared component contracts and accessibility expectations. |
| [design-system/CODEX-HANDOFF.md](design-system/CODEX-HANDOFF.md) | Ownership, conventions, terminology and visual acceptance criteria for the Codex workstream. |
| [sources/](sources/) | The Visual Review, the Workflow & Usability Review and Blueprint v2, as delivered. The Oct-20 operational audit and Oct-22 UI/UX audit live on their own branches (below). |
| [evidence/](evidence/) | Screenshots and verification output, per module. |

## Workstreams

| Workstream | Owns |
|---|---|
| **Claude: design system and core experience** | Tokens, global CSS, shared components, application shell and navigation, My Home, Command Dashboard and Analytics, Department Firearms and the Armory screens, Settings and Administration. |
| **Codex: operational modules** | Fleet, Equipment, Inventory, Range Days, Qualifications, Agency Training, Training Alerts, Certifications, Agency Documents. |
| **Deployment conversation: operational remediation and releases** | APIs, save semantics, validation, permissions, audit, migrations, staging and production releases. |

Modernization changes presentation and UI composition only. Anything that would change an API contract,
save behaviour, permission, custody semantics or audit write is a requirement owned by the deployment
workstream (register `owner: deployment`).

## Baseline

| | |
|---|---|
| Recorded | 2026-10-22 |
| Modernization base | `ec027f50` on `claude/integration-defects-rebased-20261021`: the latest remediation integration commit (B0–B11, F1–F6b, DC, DC2, TV, ADM-07, B8a, migrations 049–063, staging lineage `22e543d8`). |
| Not yet in the base | `claude/fix-uxrb-release-safety` (UX-RB-1…6, 19 commits, diverged at `5b9ec98d`). `claude/staging-preflight-20261021` (preflight tooling, separate lineage). `b87931b9` "searchable officer assignment picker" (2026-09-30, on `codex/aws-staging-readiness-20260902` only; the main checkout's current HEAD). Whether it is deployed, and whether it should be merged forward, is for the deployment workstream to confirm. |
| Deployed lineage | **Unresolved.** No verified post-remediation baseline has been declared by the deployment workstream (blueprint §0 Stage 0 gate). |

Consequence, per blueprint §0 and the program brief:

- Work so far is limited to what rebases cleanly: the register, contracts, tokens and the shared
  component kit (new files, plus `globals.css`). No module screen has been changed.
- Screen modernization begins on the declared baseline. Screens under remediation (inspection forms,
  range scoring, firearm custody) wait until their UX-RB fixes are merged into it, and then only their
  presentation changes.
- "Before" screenshots are re-captured on the declared baseline at 1280, 768 and 375px.

When the deployment workstream declares the baseline (commit SHA, staging deployment id, passing SV
checks), record it here and rebase the open modernization branches onto it.

## Sources consolidated into the register

| Key | Source | Where |
|---|---|---|
| OA | Operational audit, 2026-10-20, and its reconciliation | branch `claude/tracepoint-operational-audit-w567t8`, `docs/operational-audit-20261020/` |
| UX | UI/UX audit, 2026-10-22 (339 findings) and remediation plan | branch `claude/tracepoint-uiux-audit-q2sbf2`, `docs/uiux-audit-20261022/` |
| SV | Authenticated staging validation (SV-01…SV-32) | same branch, `reconciliation/register-SV.md` |
| VR | TracePoint Visual Review | [`sources/visual-review/`](sources/visual-review/) |
| WR | TracePoint Intuitive Workflow & Usability Review | [`sources/workflow-review/`](sources/workflow-review/) |
| BP | Unified UI/UX Modernization Blueprint v2 | [`sources/blueprint-v2/`](sources/blueprint-v2/) |
| REM | Operational remediation branches (UX-RB, B-, F-, DC-batches) | `claude/fix-uxrb-release-safety`, `claude/integration-defects-rebased-20261021` |

## Working rules

- The register is the only backlog. Every PR names the `MOD-` ids it resolves and updates their entries
  in the same PR. `node scripts/modernization-register.mjs` regenerates the Markdown; CI fails if it's
  stale or invalid.
- A requirement stays open until it is Verified in Production or Rejected by Owner (owner approval
  recorded). A module is complete only when all its requirements are closed.
- One branch per reviewable increment, never two workstreams in the same files. No merge into the active
  operational release branch without the deployment workstream. No independent deployments.
- Every modernized screen meets the acceptance list in
  [CODEX-HANDOFF.md](design-system/CODEX-HANDOFF.md#visual-acceptance-criteria-each-modernized-screen)
  and the blueprint §1b safety guardrails.
