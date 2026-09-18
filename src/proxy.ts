import { type NextRequest } from "next/server";

import { updateAwsNativeSession } from "@/lib/authentication/request-proxy";

export async function proxy(request: NextRequest) {
  if (process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native") return updateAwsNativeSession(request);
  return (await import("@/lib/supabase/proxy")).updateSession(request);
}

export const config = {
  matcher: [
    "/((?!api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

