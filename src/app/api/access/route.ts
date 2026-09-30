import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  resolveServerAccess,
  toAccessPayload,
} from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const result = await resolveServerAccess(request);

  if (!result.ok) {
    return accessFailureResponse(result);
  }

  return NextResponse.json(
    { access: toAccessPayload(result.context) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

