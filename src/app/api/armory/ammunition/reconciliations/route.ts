import { NextRequest, NextResponse } from "next/server";

import { RECONCILIATION_WITHDRAW_PERMISSIONS } from "@/lib/armory/reconciliation-withdraw";
import {
  accessFailureResponse,
  hasAnyServerPermission,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { ammunitionUserNames } from "@/lib/armory/ammunition-user-names";

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy dynamic database boundary */

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

  const names = await ammunitionUserNames(
    admin,
    (historyRows ?? []).flatMap((row: any) => [row.created_by, row.submitted_by, row.certified_by]),
  );

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
    submittedByUserId: row.submitted_by ?? null,
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
        submittedByUserId: null,
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
    departmentId,
    user,
  } = resolved.context;

  try {

    const canManage = hasAnyServerPermission(resolved.context, ["manage_firearms"]);

    if (!canManage) {
      return NextResponse.json(
        { error: "You do not have permission to manage ammunition reconciliation." },
        { status: 403 },
      );
    }

    const cycleRules = await reconciliationCycleRules(admin, departmentId);
    const cycle = currentCycle(cycleRules);
    const workspace = await loadReconciliation(
      admin,
      departmentId,
      cycle,
    );

    return NextResponse.json({
      ...workspace,
      // The person who submitted a count does not certify it.
      access: {
        canManage,
        canCertify: workspace.active?.submittedByUserId !== user.id,
        canWithdraw: hasAnyServerPermission(resolved.context, RECONCILIATION_WITHDRAW_PERMISSIONS),
      },
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


  if (!["save", "submit", "certify", "withdraw"].includes(action)) {
    return NextResponse.json(
      { error: "Unsupported reconciliation action." },
      { status: 400 },
    );
  }

  try {

    const canManage = hasAnyServerPermission(resolved.context, ["manage_firearms"]);

    if (!canManage) {
      return NextResponse.json(
        { error: "You do not have permission to manage ammunition reconciliation." },
        { status: 403 },
      );
    }

    const cycleRules = await reconciliationCycleRules(admin, departmentId);
    const cycle = currentCycle(cycleRules);

    let reconciliationId =
      typeof body.reconciliationId === "string" &&
      body.reconciliationId
        ? body.reconciliationId
        : null;

    const notes =
      typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim()
        : null;
    const now = new Date().toISOString();

    // C-R1: a submitted count is withdrawn only on purpose. Owner decision: it
    // needs a management permission (RECONCILIATION_WITHDRAW_PERMISSIONS), a
    // reason, and an audit record. Withdrawing changes the status alone; the
    // submitted counts stay as they were.
    if (action === "withdraw") {
      if (!hasAnyServerPermission(resolved.context, RECONCILIATION_WITHDRAW_PERMISSIONS)) {
        return NextResponse.json(
          { error: "Withdrawing a submitted reconciliation requires agency administrator permission." },
          { status: 403 },
        );
      }
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
      if (!reason) {
        return NextResponse.json(
          { error: "Enter a reason for withdrawing the submitted reconciliation." },
          { status: 400 },
        );
      }
      const { data: submission, error: submissionError } = reconciliationId
        ? await admin
            .from("ammunition_reconciliations")
            .select("id,status,submitted_at,submitted_by")
            .eq("id", reconciliationId)
            .eq("department_id", departmentId)
            .maybeSingle()
        : { data: null, error: null };
      if (submissionError) throw new Error(submissionError.message);
      const { data: withdrawn, error: withdrawError } = submission?.status === "Submitted"
        ? await admin
            .from("ammunition_reconciliations")
            .update({
              status: "Draft",
              submitted_at: null,
              submitted_by: null,
              updated_at: now,
            })
            .eq("id", reconciliationId)
            .eq("department_id", departmentId)
            .eq("status", "Submitted")
            .select("id")
            .maybeSingle()
        : { data: null, error: null };

      if (withdrawError) throw new Error(withdrawError.message);

      if (!withdrawn) {
        return NextResponse.json(
          { error: "Only a submitted reconciliation can be withdrawn to draft. Reload to see its current status." },
          { status: 409 },
        );
      }

      const { error: auditError } = await admin.from("audit_events").insert({
        department_id: departmentId,
        actor_user_id: user.id,
        action: "ammunition_reconciliation_withdrawn",
        entity_type: "ammunition_reconciliation",
        entity_id: reconciliationId,
        summary: reason,
        previous_value: { status: "Submitted", submitted_at: submission?.submitted_at ?? null, submitted_by: submission?.submitted_by ?? null },
        new_value: { status: "Draft" },
      });
      if (auditError) {
        // No unaudited withdrawal: put the submission back.
        await admin
          .from("ammunition_reconciliations")
          .update({ status: "Submitted", submitted_at: submission?.submitted_at ?? null, submitted_by: submission?.submitted_by ?? null, updated_at: now })
          .eq("id", reconciliationId)
          .eq("department_id", departmentId)
          .eq("status", "Draft");
        return NextResponse.json(
          { error: "The withdrawal could not be recorded in the audit log, so the reconciliation stays submitted." },
          { status: 500 },
        );
      }

      return NextResponse.json({ ok: true, reconciliationId });
    }

    if (action === "certify") {
      // Certification is read-only over the submitted counts, and the person
      // who submitted them cannot certify them.
      const { data: submitted, error: submittedError } = reconciliationId
        ? await admin
            .from("ammunition_reconciliations")
            .select("id,status,submitted_by")
            .eq("id", reconciliationId)
            .eq("department_id", departmentId)
            .maybeSingle()
        : { data: null, error: null };

      if (submittedError) throw new Error(submittedError.message);

      if (!submitted) {
        return NextResponse.json(
          { error: "Reconciliation record not found." },
          { status: 404 },
        );
      }

      if (submitted.status !== "Submitted") {
        return NextResponse.json(
          {
            error:
              submitted.status === "Certified"
                ? "Certified reconciliations cannot be changed."
                : "The reconciliation must be submitted before certification.",
          },
          { status: 409 },
        );
      }

      if (submitted.submitted_by === user.id) {
        return NextResponse.json(
          {
            error:
              "You submitted this count, so another person must certify it.",
          },
          { status: 403 },
        );
      }

      const { data: certified, error: certifyError } = await admin
        .from("ammunition_reconciliations")
        .update({
          ...(notes ? { notes } : {}),
          status: "Certified",
          certified_at: now,
          certified_by: user.id,
          updated_at: now,
        })
        .eq("id", reconciliationId)
        .eq("department_id", departmentId)
        .eq("status", "Submitted")
        .select("id")
        .maybeSingle();

      if (certifyError) throw new Error(certifyError.message);

      if (!certified) {
        return NextResponse.json(
          { error: "The reconciliation changed before it could be certified. Reload and try again." },
          { status: 409 },
        );
      }

      return NextResponse.json({ ok: true, reconciliationId });
    }

    // Expected quantities come from the department's lots, never from the
    // browser: the quantity on hand when a lot is first counted in this
    // reconciliation, kept on later saves.
    const { data: lotRows, error: lotError } = await admin
      .from("ammunition_lots")
      .select("id,quantity_on_hand")
      .eq("department_id", departmentId);

    if (lotError) throw new Error(lotError.message);

    const lotQuantity = new Map<string, number>(
      (lotRows ?? []).map((lot: any) => [String(lot.id), Number(lot.quantity_on_hand)]),
    );

    const unknownLot = items.find(
      (item: any) => !lotQuantity.has(String(item?.lotId ?? "")),
    );

    if (unknownLot) {
      return NextResponse.json(
        { error: "A reconciliation item does not match an ammunition lot of this department." },
        { status: 400 },
      );
    }

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
          notes,
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

    // C-R1: Save Draft or a second Submit used to rewrite a submitted count
    // and, for Save Draft, silently return it to Draft.
    if (reconciliation.status === "Submitted") {
      return NextResponse.json(
        { error: "This reconciliation is submitted and awaiting certification. Withdraw it to draft before changing the counts." },
        { status: 409 },
      );
    }

    const { data: storedItems, error: storedItemsError } = await admin
      .from("ammunition_reconciliation_items")
      .select("lot_id,expected_quantity")
      .eq("reconciliation_id", reconciliationId)
      .eq("department_id", departmentId);

    if (storedItemsError) throw new Error(storedItemsError.message);

    const storedExpected = new Map<string, number>(
      (storedItems ?? []).map((item: any) => [String(item.lot_id), Number(item.expected_quantity)]),
    );

    const rows = items.map((item: any) => {
      const lotId = String(item.lotId);
      const parsed =
        item.physicalQuantity === null ||
        item.physicalQuantity === undefined ||
        item.physicalQuantity === ""
          ? null
          : Number.parseInt(String(item.physicalQuantity), 10);
      const physicalQuantity =
        parsed !== null && Number.isFinite(parsed) && parsed >= 0
          ? parsed
          : null;
      const expectedQuantity =
        storedExpected.get(lotId) ?? lotQuantity.get(lotId) ?? 0;

      return {
        reconciliation_id: reconciliationId,
        department_id: departmentId,
        lot_id: lotId,
        expected_quantity: expectedQuantity,
        physical_quantity: physicalQuantity,
        variance:
          physicalQuantity === null
            ? null
            : physicalQuantity - expectedQuantity,
        explanation:
          typeof item.explanation === "string" &&
          item.explanation.trim()
            ? item.explanation.trim()
            : null,
      };
    });

    if (action === "submit") {
      if (rows.some((row: any) => row.physical_quantity === null)) {
        return NextResponse.json(
          { error: "Every ammunition lot requires a physical count before submission." },
          { status: 400 },
        );
      }

      if (rows.some((row: any) => row.variance !== 0 && !row.explanation)) {
        return NextResponse.json(
          { error: "Every discrepancy requires an explanation before submission." },
          { status: 400 },
        );
      }
    }

    const { error: deleteError } = await admin
      .from("ammunition_reconciliation_items")
      .delete()
      .eq("reconciliation_id", reconciliationId)
      .eq("department_id", departmentId);

    if (deleteError) throw new Error(deleteError.message);

    if (rows.length > 0) {
      const { error: itemError } = await admin
        .from("ammunition_reconciliation_items")
        .insert(rows);

      if (itemError) throw new Error(itemError.message);
    }

    const update: Record<string, unknown> = {
      notes,
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



