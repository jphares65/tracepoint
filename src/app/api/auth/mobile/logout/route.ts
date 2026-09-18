import { NextRequest, NextResponse } from "next/server";

import { readBearerToken } from "@/lib/authentication/request-bearer";
import {
  createMobileCognitoBearerResolver,
  isStagingCognitoBearerCandidate,
  stagingMobileCognitoConfiguration,
  SupabaseCognitoIdentityMappingStore,
  SupabaseCognitoMobileSessionStore,
} from "@/lib/authentication/mobile-cognito-bearer";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native") {
    return NextResponse.json({ error: "Mobile bridge logout is unavailable in AWS-native mode." }, { status: 404 });
  }
  const token = readBearerToken(request.headers.get("authorization"));
  const config = stagingMobileCognitoConfiguration(process.env);
  if (!token || !config || !isStagingCognitoBearerCandidate(token, process.env)) {
    return NextResponse.json({ error: "Cognito mobile authentication is required." }, { status: 401 });
  }

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const mobileAdmin = admin as unknown as { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };
  const mapping = new SupabaseCognitoIdentityMappingStore(mobileAdmin);
  const sessions = new SupabaseCognitoMobileSessionStore(mobileAdmin, mapping);
  const resolver = createMobileCognitoBearerResolver(config, mapping, sessions);
  const principal = await resolver.resolve(token);
  if (!principal) {
    return NextResponse.json({ error: "Cognito mobile authentication is required." }, { status: 401 });
  }
  if (!await resolver.revokeToken(principal)) {
    return NextResponse.json({ error: "The mobile session could not be revoked." }, { status: 503 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
