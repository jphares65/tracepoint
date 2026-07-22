import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseInteger(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDecimal(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

async function getCurrentUser() {
  const supabase = await createServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { user: null, error: "You must be signed in to use Armory." };
  }

  return { user, error: null };
}

async function getDepartmentId(admin: any, userId: string) {
  const { data, error } = await admin
    .from("department_memberships")
    .select("department_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.department_id ?? null;
}

async function getAccess(admin: any, departmentId: string, userId: string) {
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

  return (
    roleCodes.includes("armorer") ||
    roleCodes.includes("range_master") ||
    roleCodes.includes("administrator") ||
    permissions.includes("manage_firearms") ||
    permissions.includes("administer_department")
  );
}

async function loadLedger(admin: any, departmentId: string) {
  const [lotsResult, transactionsResult, usersResult] = await Promise.all([
    admin
      .from("ammunition_lots")
      .select("*")
      .eq("department_id", departmentId)
      .eq("is_active", true)
      .order("category")
      .order("caliber")
      .order("manufacturer"),
    admin
      .from("ammunition_transactions")
      .select(
        "*, lot:ammunition_lots(caliber,manufacturer,lot_number)",
      )
      .eq("department_id", departmentId)
      .order("created_at", { ascending: false })
      .limit(100),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (lotsResult.error) throw new Error(lotsResult.error.message);
  if (transactionsResult.error)
    throw new Error(transactionsResult.error.message);
  if (usersResult.error) throw new Error(usersResult.error.message);

  const names = new Map(
    (usersResult.data?.users ?? []).map((user: any) => [
      user.id,
      user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email ||
        "Unknown User",
    ]),
  );

  return {
    lots: lotsResult.data ?? [],
    transactions: (transactionsResult.data ?? []).map((transaction: any) => ({
      ...transaction,
      actor_name: names.get(transaction.actor_user_id) ?? "Unknown User",
    })),
  };
}

export async function GET() {
  const { user, error: authError } = await getCurrentUser();

  if (authError || !user) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  try {
    const admin = createAdminClient() as any;
    const departmentId = await getDepartmentId(admin, user.id);

    if (!departmentId) {
      return NextResponse.json(
        { error: "No active department membership was found." },
        { status: 403 },
      );
    }

    const allowed = await getAccess(admin, departmentId, user.id);

    if (!allowed) {
      return NextResponse.json(
        { error: "You do not have permission to manage ammunition." },
        { status: 403 },
      );
    }

    return NextResponse.json(await loadLedger(admin, departmentId));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The ammunition ledger could not be loaded.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const { user, error: authError } = await getCurrentUser();

  if (authError || !user) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as any;
  const action = String(body.action ?? "");

  try {
    const admin = createAdminClient() as any;
    const departmentId = await getDepartmentId(admin, user.id);

    if (!departmentId) {
      return NextResponse.json(
        { error: "No active department membership was found." },
        { status: 403 },
      );
    }

    const allowed = await getAccess(admin, departmentId, user.id);

    if (!allowed) {
      return NextResponse.json(
        { error: "You do not have permission to manage ammunition." },
        { status: 403 },
      );
    }

    if (action === "create_lot") {
      const category = body.category === "Training" ? "Training" : "Duty";
      const caliber = cleanText(body.caliber);
      const manufacturer = cleanText(body.manufacturer);
      const lotNumber = cleanText(body.lotNumber);
      const openingQuantity = parseInteger(body.openingQuantity);

      if (
        !caliber ||
        !manufacturer ||
        !lotNumber ||
        openingQuantity === null ||
        openingQuantity < 0
      ) {
        return NextResponse.json(
          {
            error:
              "Caliber, manufacturer, lot number, and opening quantity are required.",
          },
          { status: 400 },
        );
      }

      const { data: lot, error: lotError } = await admin
        .from("ammunition_lots")
        .insert({
          department_id: departmentId,
          category,
          caliber,
          manufacturer,
          load_description: cleanText(body.loadDescription),
          lot_number: lotNumber,
          purchase_date: cleanText(body.purchaseDate),
          cost_per_round: parseDecimal(body.costPerRound),
          low_stock_threshold:
            parseInteger(body.lowStockThreshold) ?? 0,
          replacement_due_date: cleanText(body.replacementDueDate),
          recall_flag: Boolean(body.recallFlag),
          notes: cleanText(body.notes),
          quantity_on_hand: openingQuantity,
          created_by: user.id,
          updated_by: user.id,
        })
        .select("id")
        .single();

      if (lotError) throw new Error(lotError.message);

      if (openingQuantity > 0) {
        const { error: transactionError } = await admin
          .from("ammunition_transactions")
          .insert({
            department_id: departmentId,
            lot_id: lot.id,
            actor_user_id: user.id,
            category,
            transaction_type: "Receive",
            quantity: openingQuantity,
            quantity_change: openingQuantity,
            recipient_type: "Opening Inventory",
            recipient_name: null,
            reference: "Initial lot creation",
            reason: null,
            notes: cleanText(body.notes),
            transaction_date: cleanText(body.purchaseDate),
          });

        if (transactionError) throw new Error(transactionError.message);
      }

      return NextResponse.json(
        { ok: true, lotId: lot.id },
        { status: 201 },
      );
    }

    if (action === "record_transaction") {
      const lotId = cleanText(body.lotId);
      const type = String(body.type ?? "");
      const quantity = parseInteger(body.quantity);

      if (
        !lotId ||
        !["Receive", "Issue", "Return", "Adjust"].includes(type) ||
        quantity === null ||
        quantity <= 0
      ) {
        return NextResponse.json(
          { error: "A valid lot, transaction type, and quantity are required." },
          { status: 400 },
        );
      }

      if (type === "Adjust" && !cleanText(body.reason)) {
        return NextResponse.json(
          { error: "A reason is required for inventory adjustments." },
          { status: 400 },
        );
      }

      const { data: lot, error: lotError } = await admin
        .from("ammunition_lots")
        .select("id,category,quantity_on_hand")
        .eq("id", lotId)
        .eq("department_id", departmentId)
        .maybeSingle();

      if (lotError) throw new Error(lotError.message);
      if (!lot) {
        return NextResponse.json(
          { error: "Ammunition lot not found." },
          { status: 404 },
        );
      }

      const quantityChange =
        type === "Issue" || type === "Adjust" ? -quantity : quantity;
      const nextQuantity = lot.quantity_on_hand + quantityChange;

      if (nextQuantity < 0) {
        return NextResponse.json(
          { error: "This transaction would create a negative balance." },
          { status: 409 },
        );
      }

      const { error: updateError } = await admin
        .from("ammunition_lots")
        .update({
          quantity_on_hand: nextQuantity,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", lotId)
        .eq("department_id", departmentId);

      if (updateError) throw new Error(updateError.message);

      const { error: transactionError } = await admin
        .from("ammunition_transactions")
        .insert({
          department_id: departmentId,
          lot_id: lotId,
          actor_user_id: user.id,
          category: lot.category,
          transaction_type: type,
          quantity,
          quantity_change: quantityChange,
          recipient_type: cleanText(body.recipientType),
          recipient_name: cleanText(body.recipientName),
          reference: cleanText(body.reference),
          reason: cleanText(body.reason),
          notes: cleanText(body.notes),
          transaction_date: cleanText(body.transactionDate),
        });

      if (transactionError) throw new Error(transactionError.message);

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: "Unsupported ammunition action." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The ammunition request failed.",
      },
      { status: 500 },
    );
  }
}
