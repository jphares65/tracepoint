import { NextResponse } from "next/server";

import {
  getPersonalRifleAccess,
  getPersonalRifleDisplayName,
  getPersonalRifleRequestContext,
  type SupabaseAuthUser,
} from "@/lib/tracepoint/personal-rifle-server";

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
    const [access, riflesResult, usersResult] = await Promise.all([
      getPersonalRifleAccess(admin, departmentId, user.id),
      admin
        .from("personal_rifles")
        .select(
          "id,owner_user_id,manufacturer,model,caliber,status,submitted_at,correction_notes,armorer_decision_notes,chief_decision_notes,expiration_date,updated_at",
        )
        .eq("department_id", departmentId)
        .order("updated_at", { ascending: false }),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    if (riflesResult.error) throw new Error(riflesResult.error.message);
    if (usersResult.error) throw new Error(usersResult.error.message);

    const usersById = new Map<string, SupabaseAuthUser>(
      ((usersResult.data?.users ?? []) as SupabaseAuthUser[]).map((item) => [
        item.id,
        item,
      ]),
    );

    const today = new Date();
    const sixtyDays = new Date();
    sixtyDays.setDate(sixtyDays.getDate() + 60);
    const items: Array<Record<string, unknown>> = [];

    for (const rifle of riflesResult.data ?? []) {
      const label = `${rifle.manufacturer} ${rifle.model}`.trim();
      const ownerName = getPersonalRifleDisplayName(
        usersById.get(rifle.owner_user_id),
      );

      if (
        access.canArmorerReview &&
        rifle.status === "Pending Armorer Review"
      ) {
        items.push({
          id: `personal-rifle-armorer-${rifle.id}`,
          kind: "personal_rifle_armorer_review",
          rifleId: rifle.id,
          title: "Personal Rifle Awaiting Armorer Review",
          detail: `${ownerName} submitted ${label} (${rifle.caliber}).`,
          href: `/firearms/personal-rifles?record=${rifle.id}&view=review`,
          priority: "High",
          createdAt: rifle.submitted_at ?? rifle.updated_at,
        });
      }

      if (
        access.canChiefReview &&
        rifle.status === "Pending Chief Approval"
      ) {
        items.push({
          id: `personal-rifle-chief-${rifle.id}`,
          kind: "personal_rifle_chief_review",
          rifleId: rifle.id,
          title: "Personal Rifle Awaiting Final Approval",
          detail: `${ownerName}'s ${label} passed armorer review.`,
          href: `/firearms/personal-rifles?record=${rifle.id}&view=review`,
          priority: "High",
          createdAt: rifle.updated_at,
        });
      }

      if (
        rifle.owner_user_id === user.id &&
        rifle.status === "Correction Requested"
      ) {
        items.push({
          id: `personal-rifle-correction-${rifle.id}`,
          kind: "personal_rifle_owner_correction",
          rifleId: rifle.id,
          title: "Personal Rifle Correction Required",
          detail:
            rifle.correction_notes || `Corrections are required for ${label}.`,
          href: `/firearms/personal-rifles?record=${rifle.id}&edit=1`,
          priority: "High",
          createdAt: rifle.updated_at,
        });
      }

      if (
        rifle.owner_user_id === user.id &&
        ["Armorer Denied", "Denied", "Revoked"].includes(rifle.status)
      ) {
        items.push({
          id: `personal-rifle-decision-${rifle.id}`,
          kind: "personal_rifle_owner_decision",
          rifleId: rifle.id,
          title:
            rifle.status === "Revoked"
              ? "Personal Rifle Approval Revoked"
              : "Personal Rifle Request Denied",
          detail:
            rifle.chief_decision_notes ||
            rifle.armorer_decision_notes ||
            `${label} was not approved.`,
          href: `/firearms/personal-rifles?record=${rifle.id}`,
          priority: "Normal",
          createdAt: rifle.updated_at,
        });
      }

      if (
        rifle.owner_user_id === user.id &&
        rifle.status === "Approved" &&
        rifle.expiration_date
      ) {
        const expiration = new Date(`${rifle.expiration_date}T00:00:00`);
        if (
          !Number.isNaN(expiration.getTime()) &&
          expiration >= today &&
          expiration <= sixtyDays
        ) {
          items.push({
            id: `personal-rifle-expiration-${rifle.id}`,
            kind: "personal_rifle_expiration",
            rifleId: rifle.id,
            title: "Personal Rifle Approval Expiring",
            detail: `${label} expires on ${rifle.expiration_date}.`,
            href: `/firearms/personal-rifles?record=${rifle.id}`,
            priority: "Normal",
            createdAt: rifle.updated_at,
          });
        }
      }
    }

    return NextResponse.json({ access, items });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Personal rifle inbox could not be loaded.",
      },
      { status: 500 },
    );
  }
}
