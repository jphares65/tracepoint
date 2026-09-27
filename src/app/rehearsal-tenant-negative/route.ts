import type { NextRequest } from "next/server";
import { GET as runTenantNegativeProof } from "@/app/api/internal/rehearsal-tenant-negative/route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runTenantNegativeProof(request);
}
