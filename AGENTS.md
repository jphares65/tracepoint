<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TracePoint change classes

## Application-only

Normal TracePoint feature, UI, workflow, API, repository, reporting, validation, and application database work is application-only. Codex may implement, test, and deploy these changes to staging with `scripts/deploy-app.ps1` without repeated approval checkpoints.

The canonical application deployment path builds the reviewed, clean Git commit, pushes its immutable ECR image, registers an ECS task-definition revision copied from the live application pattern with only its image changed, and updates only the existing application ECS service. It must not run CDK or CloudFormation reconciliation.

## Infrastructure/security

IAM, CDK/CloudFormation, networking, Cognito configuration, WAF, DNS, SES, AWS account configuration, secrets architecture, backup architecture, and other platform or security changes are infrastructure/security work. They require explicit review and approval before deployment.

Do not use `scripts/deploy-app.ps1` to make, reconcile, or work around infrastructure/security changes.
