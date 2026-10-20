# B6 infrastructure proposal: scheduled notification jobs (for authorization)

**Status: proposal only. Nothing below has been written to `infra/**`, synthesized or deployed.**

The owner's constraint: "You may prepare and test the notification scheduler implementation locally, but infrastructure changes require a separate proposal and authorization."

The application side is in `docs/remediation/B6-notification-delivery.md`: the proxy allow-list, `POST /api/notifications/generate`, the dispatcher recipient check, and migration 047.

## 1. What the owner is asked to authorize

| # | Item | Environment |
|---|---|---|
| A1 | A new CDK stack, `tracepoint-<env>-notification-jobs`, containing one Lambda invoker, two EventBridge Scheduler schedules (created **DISABLED**), one SQS dead-letter queue, two CloudWatch alarms and the IAM roles in §4 | staging first; production separately |
| A2 | A dedicated Secrets Manager secret, `tracepoint/<env>/notification-jobs`, holding the job bearer value. The AWS-native runtime task reads `NOTIFICATION_DISPATCH_SECRET` from it, which is a change to `runtime-stack.ts` (§5, option A). Option B avoids this change but gives the invoker the whole application secret | staging, then production |
| A3 | Applying migration `047_notification_job_recipients.sql` (application ledger) | staging, then production |
| A4 | Enabling the schedules, in the order in §9, after the staging checks pass | staging, then production |
| A5 | Emails will reach real members once production is enabled. On first enablement, expect at most one digest per member per digest window, containing every currently open Critical item (TRN-05 is unchanged) | production |

Nothing in this proposal changes `.github/workflows` or the release scripts.

## 2. Current state (evidence)

- `infra/lib` has no `Schedule`, Scheduler, Rule or `ScheduledFargateTask` targeting the app, except the backup plan (`backup-recovery-stack.ts:42,49`).
- The SES Lambda is a feedback consumer, not a dispatcher (`ses-feedback-worker-stack.ts:117`).
- The legacy invoker was an out-of-repo Supabase `pg_cron` job, `*/15`, calling Vercel. The cutover fence pauses it (`supabase/production-cutover/20260927_activate_source_fence.sql:124`).
- The Sep 27 inventory recorded "Production EventBridge Scheduler had zero schedules".
- Before B6, an aws-native bearer-only call was rejected by the proxy (401). After B6, both job paths reach their routes, which require the secret.
- **Before authorization, live-check the account for any out-of-band schedule (§10, step 0).**

## 3. Design

```
EventBridge Scheduler ──(every 15 min, input {"job":"dispatch"})────▶ Lambda notification-job-invoker
EventBridge Scheduler ──(every 6 h,   input {"job":"generate"})────▶      │  HTTPS POST + Authorization: Bearer <secret>
                                                                         ▼
                                     https://<site>/api/notifications/email-dispatch   (one call)
                                     https://<site>/api/notifications/generate         (pages: limit 50, nextCursor)
```

Why a Lambda and not something simpler:

- EventBridge **Scheduler** cannot call HTTPS endpoints directly.
- An EventBridge **Rule** with an API destination has a 5-second timeout and cannot follow `nextCursor`.
- An ECS scheduled task would start a full app container just to make one HTTP call.

The Lambda runs **outside the VPC**. The runtime ALB is public, HTTPS-only and WAF-fronted (`runtime-stack.ts`: `publicLoadBalancer: true`), so the Lambda needs no NAT, ENIs or new security-group rules. It calls the public site origin (`NEXT_PUBLIC_SITE_URL`) with TLS verification.

The job routes run inside the existing app tasks, which already have the database, SES, the enqueue function and RLS.

Paging and limits:

- Each `generate` call handles one page of at most 50 members. That is about 15 queries per member, well under the ALB's 60-second idle timeout.
- The invoker follows `nextCursor` until it is null.
- If less than 70 seconds of Lambda time remain, it re-invokes itself asynchronously with the cursor. The Lambda timeout is 5 minutes.
- A page answered 409 means another run holds the advisory lock. The invoker stops quietly; the next schedule picks up.
- Writes are idempotent upserts, so overlapping or retried pages are safe.

## 4. CDK construct sketch (new file `infra/lib/notification-jobs-stack.ts`, not yet created)

```ts
import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as scheduler from "aws-cdk-lib/aws-scheduler";            // stable L2 in aws-cdk-lib >= 2.186 (infra pins ^2.210)
import * as schedulerTargets from "aws-cdk-lib/aws-scheduler-targets";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export interface NotificationJobsProps extends cdk.StackProps {
  environmentName: "staging" | "production";
  siteUrl: string;                       // e.g. https://staging.tracepointhq.com (must equal NEXT_PUBLIC_SITE_URL)
  dataKey: kms.IKey;                     // compute-foundation dataKey (encrypts secrets and logs)
  alertTopic: sns.ITopic;                // tracepoint-<env>-runtime-alerts (alert-delivery-stack)
  schedulesEnabled?: boolean;            // default false: deploy disabled, enable by a separate approved change
}

export class NotificationJobsStack extends cdk.Stack {
  readonly jobSecret: secretsmanager.Secret;
  constructor(scope: Construct, id: string, props: NotificationJobsProps) {
    super(scope, id, props);
    if (this.region !== "us-east-1" || !/^https:\/\/[a-z0-9.-]+$/.test(props.siteUrl)) throw new Error("notification jobs target");

    // A2 option A: the job bearer lives alone; the runtime reads the same value.
    this.jobSecret = new secretsmanager.Secret(this, "JobSecret", {
      secretName: `tracepoint/${props.environmentName}/notification-jobs`,
      encryptionKey: props.dataKey,
      generateSecretString: { secretStringTemplate: "{}", generateStringKey: "NOTIFICATION_DISPATCH_SECRET", passwordLength: 64, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const logGroup = new logs.LogGroup(this, "InvokerLogs", {
      logGroupName: `/tracepoint/${props.environmentName}/notification-jobs`,
      encryptionKey: props.dataKey,
      retention: props.environmentName === "production" ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const role = new iam.Role(this, "InvokerRole", { assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com") });
    role.addToPolicy(new iam.PolicyStatement({ actions: ["logs:CreateLogStream", "logs:PutLogEvents"], resources: [`${logGroup.logGroupArn}:*`] }));
    role.addToPolicy(new iam.PolicyStatement({ actions: ["secretsmanager:GetSecretValue"], resources: [this.jobSecret.secretArn] }));
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["kms:Decrypt"], resources: [props.dataKey.keyArn],
      conditions: { StringEquals: { "kms:ViaService": `secretsmanager.${this.region}.amazonaws.com` } },
    }));

    const invoker = new lambdaNode.NodejsFunction(this, "Invoker", {
      entry: path.resolve(__dirname, "../../src/lib/notifications/job-invoker-handler.ts"),   // §6; added only with this stack
      handler: "handler", runtime: lambda.Runtime.NODEJS_24_X, role, logGroup,
      timeout: cdk.Duration.minutes(5), memorySize: 256,
      environment: { TRACEPOINT_SITE_URL: props.siteUrl, TRACEPOINT_JOB_SECRET_ARN: this.jobSecret.secretArn, GENERATION_PAGE_LIMIT: "50" },
      bundling: { minify: true, sourceMap: true },
    });
    invoker.grantInvoke(role);   // self re-invocation with a cursor (async), only this function

    const deadLetters = new sqs.Queue(this, "ScheduleDeadLetters", {
      encryptionMasterKey: props.dataKey, retentionPeriod: cdk.Duration.days(14), enforceSSL: true,
    });
    const enabled = props.schedulesEnabled === true;
    const target = (job: "dispatch" | "generate", retries: number) => new schedulerTargets.LambdaInvoke(invoker, {
      input: scheduler.ScheduleTargetInput.fromObject({ job }),
      deadLetterQueue: deadLetters, retryAttempts: retries, maxEventAge: cdk.Duration.minutes(10),
    });
    new scheduler.Schedule(this, "DispatchSchedule", {
      scheduleName: `tracepoint-${props.environmentName}-notification-dispatch`,
      schedule: scheduler.ScheduleExpression.rate(cdk.Duration.minutes(15)),
      target: target("dispatch", 0),           // the next run is 15 min away; the queue keeps its own retry state
      enabled, description: "POST /api/notifications/email-dispatch (TRN-08)",
    });
    new scheduler.Schedule(this, "GenerationSchedule", {
      scheduleName: `tracepoint-${props.environmentName}-notification-generation`,
      // 05:23, 11:23, 17:23, 23:23 America/New_York: the first run lands before the 13:00 UTC daily digest.
      schedule: scheduler.ScheduleExpression.cron({ minute: "23", hour: "5,11,17,23", timeZone: cdk.TimeZone.AMERICA_NEW_YORK }),
      target: target("generate", 1),
      enabled, description: "POST /api/notifications/generate, paged (TRN-01 / FLT-05)",
    });

    const action = new cwActions.SnsAction(props.alertTopic);
    new cloudwatch.Alarm(this, "InvokerErrors", {
      alarmName: `tracepoint-${props.environmentName}-notification-jobs-errors`,
      metric: invoker.metricErrors({ period: cdk.Duration.minutes(15), statistic: "Sum" }),
      threshold: 1, evaluationPeriods: 2, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Notification dispatch or generation failed twice in a row (401/5xx, member failures, or timeouts).",
    }).addAlarmAction(action);
    new cloudwatch.Alarm(this, "ScheduleDeadLetters", {
      alarmName: `tracepoint-${props.environmentName}-notification-jobs-undelivered`,
      metric: deadLetters.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(5) }),
      threshold: 1, evaluationPeriods: 1, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(action);
  }
}
```

**Runtime change (A2 option A):** in `runtime-stack.ts`, add a `notificationJobSecret?: secretsmanager.ISecret` prop. Source the existing `NOTIFICATION_DISPATCH_SECRET` from `ecs.Secret.fromSecretsManager(props.notificationJobSecret ?? props.appSecrets, "NOTIFICATION_DISPATCH_SECRET")`, and grant the execution role `GetSecretValue` on that ARN. This needs a task-definition revision and a rolling deploy.

**Stack wiring:**

- **Staging:** in `infra/bin` / `staging-synthesizer.ts`, after compute and alert delivery: `new NotificationJobsStack(app, "tracepoint-staging-notification-jobs", { env: { account: "559054714699", region: "us-east-1" }, environmentName: "staging", siteUrl, dataKey, alertTopic, schedulesEnabled: false, terminationProtection: true, tags: {...} })`.
- **Production:** the same in `production-assembly.ts`, under its own authorization.
- **cdk-nag:** expect `AwsSolutions-IAM5` for the log-stream suffix (suppress with the same reason as `ses-feedback-worker-stack.ts`) and `AwsSolutions-SQS3` on the DLQ itself.

## 5. Secret handling

- **Option A (recommended):** a dedicated secret.
  - The invoker can read only the job bearer, not the Supabase, Brevo, Cognito or encryption keys in `tracepoint/<env>/application[/aws-native]`.
  - It is generated by Secrets Manager (64 characters; the production publication check requires at least 32, `production-publication-core.mjs:42`) and encrypted with the existing data key.
  - The only readers are the invoker role and the runtime execution role.
- **Option B (no runtime-stack change):** grant the invoker `GetSecretValue` on the existing application secret.
  - It is simpler, but the Lambda role can then read every application secret.
  - Not recommended.
- **Handling rules:**
  - The value never appears in environment variables, CDK output, logs or schedule input. The invoker fetches it per invocation.
  - WAF logging already redacts `authorization` (`request-controls-stack.ts:40`). The app does not log request headers.
  - The routes compare digests in constant time (B6).
- **Rotation:**
  1. Update the secret value.
  2. Force a new ECS deployment so the tasks read the new value.
  3. Until the tasks restart, calls get 401; the next scheduled run succeeds.
  4. Expect one alarm evaluation at most.
- **Same secret for both jobs:** B6 reuses the existing dispatch secret, as instructed. Separate per-job secrets would be an enhancement.

## 6. Invoker handler (to be added with the stack as `src/lib/notifications/job-invoker-handler.ts`; sketch)

```ts
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { Context } from "aws-lambda";

const secrets = new SecretsManagerClient({});
const lambda = new LambdaClient({});
type Event = { job: "dispatch" | "generate"; after?: { departmentId: string; userId: string } | null; departmentId?: string };

export async function handler(event: Event, context: Context) {
  const value = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.TRACEPOINT_JOB_SECRET_ARN }));
  const bearer = JSON.parse(value.SecretString ?? "{}").NOTIFICATION_DISPATCH_SECRET;
  if (typeof bearer !== "string" || bearer.length < 32) throw new Error("Notification job secret is not configured.");
  const post = async (path: string, body: unknown) => {
    const response = await fetch(new URL(path, process.env.TRACEPOINT_SITE_URL), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(55_000),
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, any> };
  };
  if (event.job === "dispatch") {
    const result = await post("/api/notifications/email-dispatch", {});
    console.log(JSON.stringify({ event: "notification_dispatch", status: result.status, ...pick(result.body) }));
    if (result.status !== 200) throw new Error(`Dispatch returned ${result.status}.`);
    return;
  }
  let after = event.after ?? null, failed = 0;
  do {
    const result = await post("/api/notifications/generate", { limit: Number(process.env.GENERATION_PAGE_LIMIT ?? 50), after, departmentId: event.departmentId });
    console.log(JSON.stringify({ event: "notification_generation_page", status: result.status, ...pick(result.body) }));
    if (result.status === 409) return;                       // another run holds the lock
    if (result.status !== 200 && result.status !== 503) throw new Error(`Generation returned ${result.status}.`);
    failed += Number(result.body.failed ?? 0);
    after = result.body.nextCursor ?? null;
    if (after && context.getRemainingTimeInMillis() < 70_000) {   // continue in a fresh invocation
      await lambda.send(new InvokeCommand({ FunctionName: context.functionName, InvocationType: "Event", Payload: Buffer.from(JSON.stringify({ ...event, after })) }));
      break;
    }
  } while (after);
  if (failed) throw new Error(`Notification generation failed for ${failed} members.`);   // drives the alarm
}
const pick = (body: Record<string, any>) => Object.fromEntries(["ok", "attempted", "generated", "skipped", "failed", "sentMessages", "cancelledItems", "failedGroups"].filter((key) => key in body).map((key) => [key, body[key]]));
```

The handler logs only counts. It never logs the bearer, ids or emails; the app's own failure log carries member ids. Its tests come with the stack: a fetch double for the paging, 409, 401 and 503 cases, plus a self-invoke assertion.

## 7. Volume, schedule and cost

- **Expected email volume:**
  - The queue groups items by member, and the default digest is Daily at 13:00 UTC, so each member gets at most one email per day, or per hour with `Immediate`.
  - The first production run will include every Critical item that is already open (expired certifications, overdue agency training, overdue fleet dates for fleet managers), because these were never generated for members who do not sign in.
  - Before enabling, run on the production database, read-only: `select count(distinct (department_id,user_id)) from department_memberships m join departments d on d.id=m.department_id where m.is_active and d.is_active;` That is the maximum number of first-day recipients.
- **Load:**
  - About 15 short queries per member per run, each in its own subject-bound transaction.
  - 1,000 members × 4 runs a day is about 60,000 queries a day, spread over about 20 pages per run.
  - Generation shares the web tasks. Pages are sequential and each lasts seconds.
- **Cost per environment per month** (us-east-1 list prices):

  | Item | Cost |
  |---|---|
  | Scheduler, about 3,000 invocations | within the 14M free tier, about $0 |
  | Lambda, about 3,000 × ≤30 s × 256 MB ≈ 22,500 GB-s | within the free tier, otherwise under $0.40 |
  | Secrets Manager | $0.40 for the secret, plus about $0.02 in API calls |
  | CloudWatch Logs and two alarms | about $0.25 |
  | SQS DLQ | about $0 |
  | **Total** | **about $1 a month** |

  SES sending is unchanged per message ($0.10 per 1,000), and the volume follows the bullets above.

## 8. Rollback

1. **Immediate stop, no deploy:** `aws scheduler update-schedule --name tracepoint-<env>-notification-generation --state DISABLED ...`, and the same for `-notification-dispatch`. Pass the existing expression and target (the update API is a full replace), or use the console toggle. Queued rows stay `Pending`, and nothing is sent.
2. **Code rollback:** `cdk deploy` with `schedulesEnabled: false`. Then destroy the `notification-jobs` stack; the secret is retained by policy.
3. **Option A runtime change:** redeploy the runtime with the previous task definition, which sources the value from the application secret.
4. **Application rollback:** see `B6-notification-delivery.md`.
5. **Undo an unwanted send wave:** no undo is possible for sent mail. Pause dispatch first; `Pending` rows can be set to `Cancelled` by SQL under change control.

## 9. Staging test plan (after authorization; README §8 tenants `acceptance-<UUID>` only)

0. **Pre-check:** `aws scheduler list-schedules` and `aws events list-rules`. Confirm there is no other invoker (R4 TRN-08 note).
1. **Apply and deploy:**
   - Apply 047 (`migrate-db.ps1 staging -Action status` then `apply`).
   - Deploy the B6 image and the option-A runtime change.
   - Deploy the stack with `schedulesEnabled: false`.
2. **Negative checks:**
   - From a workstation: `curl -X POST https://<staging>/api/notifications/generate` with no `Authorization` header, then with a wrong bearer. Expect 401 for both.
   - `GET /api/notifications` without a session: 401.
   - S10 (tenant-negative): all-deny.
3. **Manual invoke, generation:**
   - In the Lambda console, run a test event `{"job":"generate","departmentId":"<acceptance tenant id>"}`.
   - Expect `notification_generation_page` logs with `failed: 0`.
   - S6: the never-signed-in user's expiring and expired certifications appear in `notification_events`. The expired one has a `Pending` queue row.
4. **Manual invoke, dispatch** (`{"job":"dispatch"}`):
   - The queue row becomes `Sent` with an SES message id, and the mailbox receives one digest.
   - Deactivate a second acceptance member who has a due row, then invoke dispatch. Expect `Cancelled` (TRN-16).
5. **Next-day checks:**
   - Snooze the alert as the user. The next day, invoke generation. Expect the same fingerprint, the snooze kept and no new queue row (TRN-10).
   - The mobile inbox shows the item.
6. **Enable the dispatch schedule only** (A4) and watch for 24 h: no alarms, and the WAF `RequestFlood` metric is unaffected.
7. **Enable the generation schedule** and watch two runs: logs, alarm state, and new queue rows only for acceptance tenants' Critical items.
8. **Record** for each step: date, commit, image digest, tester and result (README §8 format).
9. **Production:** a separate authorization (A1–A5). Repeat steps 0–7, using the volume query in §7 before step 7.

## 10. Risks

- **First-run email wave in production** (§7). Mitigations: enable dispatch first; read the volume query; optionally run generation per agency (`departmentId`) over several days.
- **The AWS-native DATE contract** (B6 record, owner decision 2). B6 normalises certification readiness. Other alert detail text can show a long date string (fleet "Configured date: …"); this is cosmetic, and fingerprints are unaffected.
- **Off-duty cross-user notifications stay RLS-denied on AWS-native.** This is independent of scheduling.
- **WAF rate rule:** it limits by IP. The invoker makes ≤ 1 + pages requests per run, far below the limit.
- **ALB idle timeout (60 s):** keep `GENERATION_PAGE_LIMIT` ≤ 50. Lower it if p99 page latency nears 30 s.
