# Register schema

Each `*.json` file in this folder is `{ "requirements": [ ... ] }`. One file per workstream group
(`platform.json`, `armory.json`, `range-training.json`, `assets-documents.json`, `administration.json`).
`node scripts/modernization-register.mjs` validates every file and regenerates
[`../REGISTER.md`](../REGISTER.md) and [`../COMPLETION-MATRIX.md`](../COMPLETION-MATRIX.md).
CI runs the same validation through `scripts/modernization-register.test.mjs`.

## Fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | `MOD-<PREFIX>-NNN`. The prefix is fixed by the module (see `MODULES` in the script). Never reuse or renumber an id. |
| `title` | yes | Short name of the requirement. |
| `module` | yes | Module key, for example `firearms`, `fleet`, `shell`. |
| `screen` | yes | Route or screen, for example `/firearms (list)`. |
| `category` | yes | `functional`, `workflow`, `visual`, `accessibility` or `infrastructure`. |
| `owner` | yes | `claude`, `codex`, `deployment` or `unassigned`. |
| `track` | yes | Blueprint §2b: `A` presentational, `B` UI workflow over existing APIs, `C` needs new backend, `ops` operational defect or infrastructure owned by the deployment team. |
| `priority` | yes | `P0`, `P1`, `P2` (blueprint priority, or the source's severity mapped: Critical/High → P0, Medium → P1, Low → P2). |
| `release` | no | Blueprint stage: `R1` … `R5`. |
| `sources` | yes | `[{ "doc": "UX", "ref": "C-12" }, …]`. Every original finding that this requirement consolidates. Doc keys: `OA`, `UX`, `SV`, `VR`, `WR`, `BP`, `REM`. |
| `requirement` | yes | The required improvement, stated as an outcome. |
| `acceptance` | yes | Testable acceptance criteria. |
| `dependencies` | no | Other `MOD-` ids or external refs (`UX-RB-4`, `track C: approvals API`). |
| `implementation` | no | `{ "branch": "", "commits": [], "pr": "" }`. |
| `evidence` | no | Test names, screenshot paths, staging run ids. |
| `status` | yes | See below. |
| `staging`, `production` | no | `Not released` (default), `Released`, `Verified`. |
| `ownerApproval` | when rejected | Where the owner approved the rejection. |
| `notes` | no | Anything else, including why it is blocked. |

## Status rules

`Not Started` → `In Progress` → `Implemented` → `Verified in Staging` → `Verified in Production`.
`Blocked` and `Rejected by Owner` can happen at any point.

- A requirement is **open** until it is `Verified in Production` or `Rejected by Owner`.
- `Implemented` and later need an implementation branch, commit or PR.
- `Verified in Staging` and `Verified in Production` need evidence and the matching release state.
- `Rejected by Owner` needs `ownerApproval`. Only the product owner can reject a requirement.
- `Blocked` needs a dependency or a note naming the blocker.
- A module is complete only when all of its requirements are closed.

## Deduplication

When several findings describe the same defect or improvement, they become one requirement whose
`sources` lists all of them. When one finding covers several modules, the platform-wide part goes to
`design-system` or `shell`, and each module-specific instance gets its own requirement that depends on it.
