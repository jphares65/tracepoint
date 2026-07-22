import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  resolveServerAccess,
  toAccessPayload,
} from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await resolveServerAccess();

  if (!result.ok) {
    return accessFailureResponse(result);
  }

  return NextResponse.json(
    { access: toAccessPayload(result.context) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
