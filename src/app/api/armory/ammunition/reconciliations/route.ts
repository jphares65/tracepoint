import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

type ReconciliationCycleRules = {
  spring_cycle_start: string;
  spring_cycle_end: string;
  fall_cycle_start: string;
  fall_cycle_end: string;
};

const DEFAULT_CYCLE_RULES: ReconciliationCycleRules = {
  spring_cycle_start: "04-01",
  spring_cycle_end: "06-30",
  fall_cycle_start: "09-01",
  fall_cycle_end: "11-30",
};

function localDateString(now: Date) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentCycle(
  rules: ReconciliationCycleRules,
  now = new Date(),
) {
  const year = now.getFullYear();
  const today = localDateString(now);

  const cycles = [
    {
      name: "Spring" as const,
      year,
      start: `${year}-${rules.spring_cycle_start}`,
      end: `${year}-${rules.spring_cycle_end}`,
    },
    {
      name: "Fall" as const,
      year,
      start: `${year}-${rules.fall_cycle_start}`,
      end: `${year}-${rules.fall_cycle_end}`,
    },
  ];

  const openCycle = cycles.find(
    (cycle) => today >= cycle.start && today <= cycle.end,
  );

  if (openCycle) {
    return {
      ...openCycle,
      isOpen: true,
    };
  }

  const futureCycles = [
    ...cycles.filter((cycle) => cycle.start > today),
    {
      name: "Spring" as const,
      year: year + 1,
      start: `${year + 1}-${rules.spring_cycle_start}`,
      end: `${year + 1}-${rules.spring_cycle_end}`,
    },
    {
      name: "Fall" as const,
      year: year + 1,
      start: `${year + 1}-${rules.fall_cycle_start}`,
      end: `${year + 1}-${rules.fall_cycle_end}`,
    },
  ].sort((left, right) => left.start.localeCompare(right.start));

  const nextCycle = futureCycles[0];

  return {
    ...nextCycle,
    isOpen: false,
  };
}

async function reconciliationCycleRules(
  admin: any,
  departmentId: string,
): Promise<ReconciliationCycleRules> {
  const { data, error } = await admin
    .from("department_rules")
    .select(
      "spring_cycle_start,spring_cycle_end,fall_cycle_start,fall_cycle_end",
    )
    .eq("department_id", departmentId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return {
    spring_cycle_start:
      data?.spring_cycle_start ?? DEFAULT_CYCLE_RULES.spring_cycle_start,
    spring_cycle_end:
      data?.spring_cycle_end ?? DEFAULT_CYCLE_RULES.spring_cycle_end,
    fall_cycle_start:
      data?.fall_cycle_start ?? DEFAULT_CYCLE_RULES.fall_cycle_start,
    fall_cycle_end:
      data?.fall_cycle_end ?? DEFAULT_CYCLE_RULES.fall_cycle_end,
  };
}

async function reconciliationAccess(
  admin: any,
  departmentId: string,
  userId: string,
) {
  const { data: roleRows, error: roleError } = await admin
    .from("department_membership_roles")
    .select("role_code")
    .eq("department_id", departmentId)
    .eq("user_id", userId);

  if (roleError) throw new Error(roleError.message);

  const roleCodes = Array.from(
    new Set(
      (roleRows ?? [])
        .map((row: any) => row.role_code)
        .filter((value: unknown): value is string => Boolean(value)),
    ),
  );

  let permissions: string[] = [];

  if (roleCodes.length > 0) {
    const { data: permissionRows, error: permissionError } = await admin
      .from("department_role_permissions")
      .select("permission_code")
      .eq("department_id", departmentId)
      .in("role_code", roleCodes);

    if (permissionError) throw new Error(permissionError.message);

    permissions = Array.from(
      new Set(
        (permissionRows ?? [])
          .map((row: any) => row.permission_code)
          .filter((value: unknown): value is string => Boolean(value)),
      ),
    );
  }

  const canManage =
    roleCodes.includes("armorer") ||
    roleCodes.includes("range_master") ||
    roleCodes.includes("administrator") ||
    roleCodes.includes("chief") ||
    roleCodes.includes("command_staff") ||
    permissions.includes("manage_firearms") ||
    permissions.includes("administer_department");

  const canCertify =
    roleCodes.includes("administrator") ||
    roleCodes.includes("chief") ||
    roleCodes.includes("command_staff") ||
    permissions.includes("administer_department");

  return { canManage, canCertify };
}

async function userNames(admin: any) {
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (error) throw new Error(error.message);

  return new Map(
    (data?.users ?? []).map((user: any) => [
      user.id,
      user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email ||
        "Unknown User",
    ]),
  );
}

async function loadReconciliation(
  admin: any,
  departmentId: string,
  cycle: ReturnType<typeof currentCycle>,
) {
  const { data: historyRows, error: historyError } = await admin
    .from("ammunition_reconciliations")
    .select("*")
    .eq("department_id", departmentId)
    .order("cycle_year", { ascending: false })
    .order("cycle_name", { ascending: false });

  if (historyError) throw new Error(historyError.message);

  const activeRow =
    (historyRows ?? []).find(
      (row: any) =>
        row.cycle_name === cycle.name &&
        row.cycle_year === cycle.year,
    ) ?? null;

  const reconciliationIds = (historyRows ?? []).map(
    (row: any) => row.id,
  );

  let itemRows: any[] = [];

  if (reconciliationIds.length > 0) {
    const { data, error } = await admin
      .from("ammunition_reconciliation_items")
      .select(
        "*, lot:ammunition_lots(category,caliber,manufacturer,lot_number)",
      )
      .in("reconciliation_id", reconciliationIds);

    if (error) throw new Error(error.message);
    itemRows = data ?? [];
  }

  const names = await userNames(admin);

  const mapReconciliation = (row: any) => ({
    id: row.id,
    cycleName: row.cycle_name,
    cycleYear: row.cycle_year,
    cycleStart: row.cycle_start,
    cycleEnd: row.cycle_end,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    certifiedAt: row.certified_at,
    createdByName: names.get(row.created_by) ?? "Unknown User",
    submittedByName: row.submitted_by
      ? names.get(row.submitted_by) ?? "Unknown User"
      : null,
    certifiedByName: row.certified_by
      ? names.get(row.certified_by) ?? "Unknown User"
      : null,
    items: itemRows
      .filter(
        (item: any) => item.reconciliation_id === row.id,
      )
      .map((item: any) => ({
        lotId: item.lot_id,
        category: item.lot?.category ?? "Duty",
        caliber: item.lot?.caliber ?? "Unknown",
        manufacturer: item.lot?.manufacturer ?? "Unknown",
        lotNumber: item.lot?.lot_number ?? "Unknown",
        expectedQuantity: item.expected_quantity,
        physicalQuantity: item.physical_quantity,
        variance: item.variance,
        explanation: item.explanation ?? "",
      })),
  });

  if (!activeRow && cycle.isOpen) {
    const { data: lots, error: lotError } = await admin
      .from("ammunition_lots")
      .select(
        "id,category,caliber,manufacturer,lot_number,quantity_on_hand",
      )
      .eq("department_id", departmentId)
      .eq("is_active", true)
      .order("category")
      .order("caliber");

    if (lotError) throw new Error(lotError.message);

    return {
      currentCycle: cycle,
      active: {
        id: "",
        cycleName: cycle.name,
        cycleYear: cycle.year,
        cycleStart: cycle.start,
        cycleEnd: cycle.end,
        status: "Draft",
        notes: null,
        createdAt: "",
        submittedAt: null,
        certifiedAt: null,
        createdByName: "",
        submittedByName: null,
        certifiedByName: null,
        items: (lots ?? []).map((lot: any) => ({
          lotId: lot.id,
          category: lot.category,
          caliber: lot.caliber,
          manufacturer: lot.manufacturer,
          lotNumber: lot.lot_number,
          expectedQuantity: lot.quantity_on_hand,
          physicalQuantity: null,
          variance: null,
          explanation: "",
        })),
      },
      history: (historyRows ?? []).map(mapReconciliation),
    };
  }

  return {
    currentCycle: cycle,
    active: activeRow ? mapReconciliation(activeRow) : null,
    history: (historyRows ?? []).map(mapReconciliation),
  };
}

export async function GET() {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const featureError = requireServerFeature(
    resolved.context,
    "ammunition",
    "Ammunition",
  );

  if (featureError) {
    return featureError;
  }
  const {
    admin,
    user,
    departmentId,
  } = resolved.context;

  try {

    const access = await reconciliationAccess(
      admin,
      departmentId,
      user.id,
    );

    if (!access.canManage) {
      return NextResponse.json(
        { error: "You do not have permission to manage ammunition reconciliation." },
        { status: 403 },
      );
    }

    const cycleRules = await reconciliationCycleRules(admin, departmentId);
    const cycle = currentCycle(cycleRules);

    return NextResponse.json({
      ...(await loadReconciliation(
        admin,
        departmentId,
        cycle,
      )),
      access,
    });
  } catch (loadError) {
    return NextResponse.json(
      {
        error:
          loadError instanceof Error
            ? loadError.message
            : "The reconciliation workspace could not be loaded.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const featureError = requireServerFeature(
    resolved.context,
    "ammunition",
    "Ammunition",
  );

  if (featureError) {
    return featureError;
  }
  const {
    admin,
    user,
    departmentId,
  } = resolved.context;

  const body = (await request.json().catch(() => ({}))) as any;
  const action = String(body.action ?? "");
  const items = Array.isArray(body.items) ? body.items : [];


  if (!["save", "submit", "certify"].includes(action)) {
    return NextResponse.json(
      { error: "Unsupported reconciliation action." },
      { status: 400 },
    );
  }

  try {

    const access = await reconciliationAccess(
      admin,
      departmentId,
      user.id,
    );

    if (!access.canManage) {
      return NextResponse.json(
        { error: "You do not have permission to manage ammunition reconciliation." },
        { status: 403 },
      );
    }

    const cycleRules = await reconciliationCycleRules(admin, departmentId);
    const cycle = currentCycle(cycleRules);

    if (action === "certify" && !access.canCertify) {
      return NextResponse.json(
        { error: "Command certification permission is required." },
        { status: 403 },
      );
    }

    let reconciliationId =
      typeof body.reconciliationId === "string" &&
      body.reconciliationId
        ? body.reconciliationId
        : null;

    if (!reconciliationId) {
      if (!cycle.isOpen) {
        return NextResponse.json(
          { error: "The seasonal reconciliation window is closed." },
          { status: 409 },
        );
      }

      const { data, error: insertError } = await admin
        .from("ammunition_reconciliations")
        .insert({
          department_id: departmentId,
          cycle_name: cycle.name,
          cycle_year: cycle.year,
          cycle_start: cycle.start,
          cycle_end: cycle.end,
          status: "Draft",
          notes:
            typeof body.notes === "string" && body.notes.trim()
              ? body.notes.trim()
              : null,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (insertError) throw new Error(insertError.message);
      reconciliationId = data.id;
    }

    const { data: reconciliation, error: reconciliationError } =
      await admin
        .from("ammunition_reconciliations")
        .select("id,status")
        .eq("id", reconciliationId)
        .eq("department_id", departmentId)
        .maybeSingle();

    if (reconciliationError)
      throw new Error(reconciliationError.message);

    if (!reconciliation) {
      return NextResponse.json(
        { error: "Reconciliation record not found." },
        { status: 404 },
      );
    }

    if (reconciliation.status === "Certified") {
      return NextResponse.json(
        { error: "Certified reconciliations cannot be changed." },
        { status: 409 },
      );
    }

    const rows = items.map((item: any) => {
      const physicalQuantity =
        item.physicalQuantity === null ||
        item.physicalQuantity === undefined ||
        item.physicalQuantity === ""
          ? null
          : Number.parseInt(String(item.physicalQuantity), 10);

      const expectedQuantity = Number.parseInt(
        String(item.expectedQuantity ?? 0),
        10,
      );

      return {
        reconciliation_id: reconciliationId,
        department_id: departmentId,
        lot_id: item.lotId,
        expected_quantity: expectedQuantity,
        physical_quantity:
          physicalQuantity !== null &&
          Number.isFinite(physicalQuantity) &&
          physicalQuantity >= 0
            ? physicalQuantity
            : null,
        variance:
          physicalQuantity !== null &&
          Number.isFinite(physicalQuantity) &&
          physicalQuantity >= 0
            ? physicalQuantity - expectedQuantity
            : null,
        explanation:
          typeof item.explanation === "string" &&
          item.explanation.trim()
            ? item.explanation.trim()
            : null,
      };
    });

    const { error: deleteError } = await admin
      .from("ammunition_reconciliation_items")
      .delete()
      .eq("reconciliation_id", reconciliationId);

    if (deleteError) throw new Error(deleteError.message);

    if (rows.length > 0) {
      const { error: itemError } = await admin
        .from("ammunition_reconciliation_items")
        .insert(rows);

      if (itemError) throw new Error(itemError.message);
    }

    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      notes:
        typeof body.notes === "string" && body.notes.trim()
          ? body.notes.trim()
          : null,
      updated_at: now,
    };

    if (action === "save") {
      update.status = "Draft";
    }

    if (action === "submit") {
      update.status = "Submitted";
      update.submitted_at = now;
      update.submitted_by = user.id;
    }

    if (action === "certify") {
      if (reconciliation.status !== "Submitted") {
        return NextResponse.json(
          {
            error:
              "The reconciliation must be submitted before certification.",
          },
          { status: 409 },
        );
      }

      update.status = "Certified";
      update.certified_at = now;
      update.certified_by = user.id;
    }

    const { error: updateError } = await admin
      .from("ammunition_reconciliations")
      .update(update)
      .eq("id", reconciliationId)
      .eq("department_id", departmentId);

    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ ok: true, reconciliationId });
  } catch (saveError) {
    return NextResponse.json(
      {
        error:
          saveError instanceof Error
            ? saveError.message
            : "The reconciliation could not be saved.",
      },
      { status: 500 },
    );
  }
}



