import { NextRequest, NextResponse } from "next/server";
import { PlatformAdminOperationError, resolvePlatformAdminAccess } from "@/lib/platform/admin-access";

type CreateAgencyRequest = {
  name: string;
  shortName?: string;
  slug: string;
  state?: string;
  county?: string;
  agencyType?: string;
  timezone?: string;
  swornOfficers?: number;
  civilianStaff?: number;
  accountStatus?: "onboarding" | "pilot" | "active";
  planType?: "pilot" | "lifetime_free" | "paid" | "internal";
  internalNotes?: string;
};

export async function GET() {
  const access = await resolvePlatformAdminAccess();
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: access.status }
    );
  }
  try { return NextResponse.json({ agencies: await access.repository.listAgencies() }); }
  catch { return NextResponse.json({ error: "Unable to load agencies." }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const access = await resolvePlatformAdminAccess();
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: access.status }
    );
  }

  let body: CreateAgencyRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const name = body.name?.trim();
  const slug = body.slug?.trim().toLowerCase();

  if (!name) {
    return NextResponse.json(
      { error: "Agency name is required." },
      { status: 400 }
    );
  }

  if (!slug) {
    return NextResponse.json(
      { error: "Agency slug is required." },
      { status: 400 }
    );
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json(
      {
        error:
          "Agency slug may contain only lowercase letters, numbers, and hyphens.",
      },
      { status: 400 }
    );
  }

  try {
    const departmentId = await access.repository.createAgency({
      name,
      shortName: body.shortName?.trim() || name,
      slug,
      state: body.state?.trim() || undefined,
      county: body.county?.trim() || undefined,
      agencyType: body.agencyType?.trim() || "Municipal Police Department",
      timezone: body.timezone?.trim() || "America/New_York",
      swornOfficers: Math.max(0, Number(body.swornOfficers ?? 0)),
      civilianStaff: Math.max(0, Number(body.civilianStaff ?? 0)),
      accountStatus: body.accountStatus || "pilot",
      planType: body.planType || "pilot",
      internalNotes: body.internalNotes?.trim() || undefined,
    });
    return NextResponse.json({ success: true, departmentId }, { status: 201 });
  } catch (error) {
    if (error instanceof PlatformAdminOperationError && error.code === "23505") {
      return NextResponse.json(
        { error: "An agency with this identifier already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Unable to provision the TracePoint agency." }, { status: 500 });
  }
}


