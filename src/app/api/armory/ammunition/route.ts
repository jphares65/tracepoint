import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

/* eslint-disable @typescript-eslint/no-explicit-any -- Provider-neutral database clients use structural query contracts in this legacy route. */
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

async function loadLedger(admin: any, departmentId: string) {
  const [lotsResult, transactionsResult] = await Promise.all([
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
  ]);

  if (lotsResult.error) throw new Error(lotsResult.error.message);
  if (transactionsResult.error)
    throw new Error(transactionsResult.error.message);
  const actorIds = [...new Set((transactionsResult.data ?? []).map((transaction: any) => transaction.actor_user_id).filter(Boolean))];
  const profilesResult = actorIds.length
    ? await admin.from("profiles").select("id,full_name,email").in("id", actorIds)
    : { data: [], error: null };
  if (profilesResult.error) throw new Error(profilesResult.error.message);

  const names = new Map(
    (profilesResult.data ?? []).map((profile: any) => [
      profile.id,
      profile.full_name ||
        profile.email ||
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
  const { admin, departmentId } = resolved.context;
  if (!hasAnyServerPermission(resolved.context, ["manage_firearms"])) {
    return permissionDeniedResponse("Firearms-management permission is required to manage ammunition.");
  }

  try {
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
  const { admin, departmentId, user } = resolved.context;
  if (!hasAnyServerPermission(resolved.context, ["manage_firearms"])) {
    return permissionDeniedResponse("Firearms-management permission is required to manage ammunition.");
  }

  const body = (await request.json().catch(() => ({}))) as any;
  const action = String(body.action ?? "");

  try {
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


