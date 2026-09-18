import { NextResponse } from "next/server";

const unavailable = () => NextResponse.json({ error: "This legacy Supabase workflow is isolated from AWS-native mode." }, { status: 501, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Parameters<typeof import("./legacy-route").POST>[0]) {
  if (process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native") return unavailable();
  return (await import("./legacy-route")).POST(request);
}
