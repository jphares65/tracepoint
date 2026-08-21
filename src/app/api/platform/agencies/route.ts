import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

async function requirePlatformAdmin() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      authorized: false as const,
      status: 401,
      supabase,
      user: null,
    };
  }

  const { data: isPlatformAdmin, error: adminError } =
    await supabase.rpc("is_platform_admin");

  if (adminError || !isPlatformAdmin) {
    return {
      authorized: false as const,
      status: 403,
      supabase,
      user,
    };
  }

  return {
    authorized: true as const,
    status: 200,
    supabase,
    user,
  };
}

export async function GET() {
  const auth = await requirePlatformAdmin();

  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: auth.status }
    );
  }

  const { supabase } = auth;

  const { data: departments, error: departmentError } =
    await supabase
      .from("departments")
      .select(`
        id,
        name,
        short_name,
        slug,
        state,
        county,
        agency_type,
        timezone,
        sworn_officers,
        civilian_staff,
        is_active,
        created_at
      `)
      .order("name");

  if (departmentError) {
    console.error("Failed to load departments:", departmentError);

    return NextResponse.json(
      { error: "Unable to load agencies." },
      { status: 500 }
    );
  }

  const { data: accounts, error: accountError } =
    await supabase
      .from("platform_agency_accounts")
      .select(`
        department_id,
        account_status,
        plan_type,
        onboarding_status,
        pilot_start_date,
        production_start_date,
        internal_notes,
        created_at,
        updated_at
      `);

  if (accountError) {
    console.error(
      "Failed to load platform agency accounts:",
      accountError
    );

    return NextResponse.json(
      { error: "Unable to load agency account information." },
      { status: 500 }
    );
  }

  const accountMap = new Map(
    (accounts ?? []).map((account) => [
      account.department_id,
      account,
    ])
  );

  const agencies = (departments ?? []).map((department) => ({
    ...department,
    platformAccount:
      accountMap.get(department.id) ?? null,
  }));

  return NextResponse.json({ agencies });
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformAdmin();

  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: auth.status }
    );
  }

  const { supabase } = auth;

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

  const { data: departmentId, error } =
    await supabase.rpc("platform_create_agency", {
      p_name: name,
      p_short_name:
        body.shortName?.trim() || name,
      p_slug: slug,
      p_state:
        body.state?.trim() || undefined,
      p_county:
        body.county?.trim() || undefined,
      p_agency_type:
        body.agencyType?.trim() ||
        "Municipal Police Department",
      p_timezone:
        body.timezone?.trim() ||
        "America/New_York",
      p_sworn_officers:
        Math.max(0, Number(body.swornOfficers ?? 0)),
      p_civilian_staff:
        Math.max(0, Number(body.civilianStaff ?? 0)),
      p_account_status:
        body.accountStatus || "pilot",
      p_plan_type:
        body.planType || "pilot",
      p_internal_notes:
        body.internalNotes?.trim() || undefined,
    });

  if (error) {
    console.error("Agency provisioning failed:", error);

    if (
      error.code === "23505" ||
      error.message?.toLowerCase().includes("duplicate")
    ) {
      return NextResponse.json(
        {
          error:
            "An agency with this identifier already exists.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        error:
          error.message ||
          "Unable to provision the TracePoint agency.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      success: true,
      departmentId,
    },
    { status: 201 }
  );
}


