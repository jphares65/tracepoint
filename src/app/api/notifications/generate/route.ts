import { NextRequest, NextResponse } from "next/server";

import { getPostgresPool } from "@/lib/database/postgres-pool";
import { authorizedNotificationJob } from "@/lib/notifications/job-authorization";
import { parseGenerationRequest, runNotificationGeneration } from "@/lib/notifications/generation-run-core";
import { postgresGenerationLock, postgresGenerationTargets } from "@/lib/notifications/generation-run-postgres";
import { generateMemberNotifications } from "@/lib/notifications/user-notification-generator";

const noStore = { "Cache-Control": "no-store" };

// Scheduled alert generation for every active member (TRN-01 / FLT-05). The
// caller pages through members with nextCursor; see
// docs/remediation/B6-infrastructure-proposal.md for the proposed invoker.
export async function POST(request: NextRequest) {
  if (!authorizedNotificationJob(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: noStore });
  }
  if (process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE !== "aws-native") {
    return NextResponse.json({ error: "Scheduled notification generation requires the AWS-native runtime." }, { status: 503, headers: noStore });
  }
  const parsed = parseGenerationRequest(await request.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: noStore });

  try {
    const pool = getPostgresPool();
    const result = await runNotificationGeneration({
      withRunLock: postgresGenerationLock(pool),
      listTargets: postgresGenerationTargets(pool),
      generate: generateMemberNotifications,
      onFailure: (target, error) => console.error(JSON.stringify({
        event: "notification_generation_member_failed",
        departmentId: target.departmentId,
        userId: target.userId,
        error: error instanceof Error ? error.message : "unknown",
      })),
    }, parsed.request);
    if (result.locked) {
      return NextResponse.json({ ok: false, error: "A notification generation run is already in progress." }, { status: 409, headers: noStore });
    }
    return NextResponse.json({ ok: result.failed === 0, ...result }, { status: result.failed ? 503 : 200, headers: noStore });
  } catch {
    return NextResponse.json({ error: "Notification generation is unavailable." }, { status: 503, headers: noStore });
  }
}
