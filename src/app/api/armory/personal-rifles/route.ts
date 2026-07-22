import { NextRequest, NextResponse } from "next/server";

import {
  cleanPersonalRifleText,
  getInitialPersonalRifleStatus,
  getPersonalRifleAccess,
  getPersonalRifleDisplayName,
  getPersonalRifleExpirationDate,
  getPersonalRifleRequestContext,
  getPersonalRifleRules,
  recordPersonalRifleHistory,
  type SupabaseAuthUser,
} from "@/lib/tracepoint/personal-rifle-server";

function serializeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET() {
  const context = await getPersonalRifleRequestContext();

  if (context.error || !context.user || !context.admin || !context.departmentId) {
    return NextResponse.json(
      { error: context.error ?? "Personal rifle access could not be resolved." },
      { status: context.user ? 403 : 401 },
    );
  }

  try {
    const { admin, departmentId, user } = context;
    const [rules, access] = await Promise.all([
      getPersonalRifleRules(admin, departmentId),
      getPersonalRifleAccess(admin, departmentId, user.id),
    ]);

    let rifleQuery = admin
      .from("personal_rifles")
      .select("*")
      .eq("department_id", departmentId)
      .order("updated_at", { ascending: false });

    if (!access.canViewAll) {
      rifleQuery = rifleQuery.eq("owner_user_id", user.id);
    }

    const { data: rifles, error: riflesError } = await rifleQuery;
    if (riflesError) throw new Error(riflesError.message);

    const rifleIds = (rifles ?? []).map((rifle: any) => rifle.id);
    const [usersResult, historyResult] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      rifleIds.length > 0
        ? admin
            .from("personal_rifle_status_history")
            .select("*")
            .in("personal_rifle_id", rifleIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (usersResult.error) throw new Error(usersResult.error.message);
    if (historyResult.error) throw new Error(historyResult.error.message);

    const usersById = new Map<string, SupabaseAuthUser>(
      ((usersResult.data?.users ?? []) as SupabaseAuthUser[]).map((item) => [
        item.id,
        item,
      ]),
    );

    const historyByRifle = new Map<string, any[]>();
    for (const history of historyResult.data ?? []) {
      const current = historyByRifle.get(history.personal_rifle_id) ?? [];
      current.push({
        ...history,
        actor_name: getPersonalRifleDisplayName(
          usersById.get(history.actor_user_id),
        ),
      });
      historyByRifle.set(history.personal_rifle_id, current);
    }

    const result = (rifles ?? []).map((rifle: any) => ({
      ...rifle,
      owner_name: getPersonalRifleDisplayName(
        usersById.get(rifle.owner_user_id),
      ),
      history: historyByRifle.get(rifle.id) ?? [],
    }));

    return NextResponse.json({
      currentUserId: user.id,
      rules,
      access,
      rifles: result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: serializeError(
          error,
          "Personally owned rifles could not be loaded.",
        ),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const context = await getPersonalRifleRequestContext();

  if (context.error || !context.user || !context.admin || !context.departmentId) {
    return NextResponse.json(
      { error: context.error ?? "Personal rifle access could not be resolved." },
      { status: context.user ? 403 : 401 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  const manufacturer = cleanPersonalRifleText(body.manufacturer);
  const model = cleanPersonalRifleText(body.model);
  const serialNumber = cleanPersonalRifleText(body.serialNumber);
  const caliber = cleanPersonalRifleText(body.caliber);

  if (!manufacturer || !model || !serialNumber || !caliber) {
    return NextResponse.json(
      { error: "Manufacturer, model, serial number, and caliber are required." },
      { status: 400 },
    );
  }

  if (!body.ownershipConfirmed) {
    return NextResponse.json(
      { error: "Ownership confirmation is required." },
      { status: 400 },
    );
  }

  try {
    const { admin, departmentId, user } = context;
    const rules = await getPersonalRifleRules(admin, departmentId);

    if (!rules.allow_personally_owned_rifles) {
      return NextResponse.json(
        { error: "Personally owned rifles are not enabled for this agency." },
        { status: 403 },
      );
    }

    const submit = body.submit === true;

    if (
      submit &&
      rules.require_personal_rifle_spec_acknowledgment &&
      !body.specificationAcknowledged
    ) {
      return NextResponse.json(
        { error: "Department specification acknowledgment is required." },
        { status: 400 },
      );
    }

    const { data: duplicate, error: duplicateError } = await admin
      .from("personal_rifles")
      .select("id")
      .eq("department_id", departmentId)
      .ilike("serial_number", serialNumber)
      .limit(1)
      .maybeSingle();

    if (duplicateError) throw new Error(duplicateError.message);
    if (duplicate) {
      return NextResponse.json(
        { error: "A personal rifle with this serial number already exists." },
        { status: 409 },
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const status = submit ? getInitialPersonalRifleStatus(rules) : "Draft";
    const immediatelyApproved = status === "Approved";

    const { data: inserted, error: insertError } = await admin
      .from("personal_rifles")
      .insert({
        department_id: departmentId,
        owner_user_id: user.id,
        manufacturer,
        model,
        serial_number: serialNumber,
        caliber,
        barrel_length: cleanPersonalRifleText(body.barrelLength),
        operating_system: cleanPersonalRifleText(body.operatingSystem),
        stock_brace_configuration: cleanPersonalRifleText(
          body.stockBraceConfiguration,
        ),
        sights_optic: cleanPersonalRifleText(body.sightsOptic),
        weapon_mounted_light: cleanPersonalRifleText(
          body.weaponMountedLight,
        ),
        sling: cleanPersonalRifleText(body.sling),
        trigger: cleanPersonalRifleText(body.trigger),
        muzzle_device: cleanPersonalRifleText(body.muzzleDevice),
        magazine_type: cleanPersonalRifleText(body.magazineType),
        other_modifications: cleanPersonalRifleText(body.otherModifications),
        ownership_confirmed: true,
        specification_acknowledged: Boolean(
          body.specificationAcknowledged,
        ),
        status,
        submitted_at: submit ? nowIso : null,
        approval_date: immediatelyApproved ? nowIso.slice(0, 10) : null,
        expiration_date: immediatelyApproved
          ? getPersonalRifleExpirationDate(rules, now)
          : null,
        updated_at: nowIso,
      })
      .select("id")
      .single();

    if (insertError) throw new Error(insertError.message);

    await recordPersonalRifleHistory(admin, {
      departmentId,
      rifleId: inserted.id,
      actorUserId: user.id,
      fromStatus: null,
      toStatus: status,
      action: submit ? "Owner Submitted" : "Draft Created",
      notes: null,
    });

    return NextResponse.json(
      {
        ok: true,
        personalRifleId: inserted.id,
        status,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = serializeError(
      error,
      "The personal rifle could not be saved.",
    );
    const duplicate =
      message.toLowerCase().includes("duplicate") ||
      message.toLowerCase().includes("unique");

    return NextResponse.json(
      {
        error: duplicate
          ? "A personal rifle with this serial number already exists."
          : message,
      },
      { status: duplicate ? 409 : 500 },
    );
  }
}
