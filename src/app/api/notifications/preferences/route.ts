import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

type DigestMode = "Immediate" | "Daily" | "Weekly";

type PreferenceRecord = {
  in_app_enabled: boolean;
  email_enabled: boolean;
  critical_email_only: boolean;
  digest_mode: DigestMode;
  source_preferences: Record<string, boolean>;
  updated_at?: string | null;
};

const DEFAULT_PREFERENCES: PreferenceRecord = {
  in_app_enabled: true,
  email_enabled: true,
  critical_email_only: true,
  digest_mode: "Daily",
  source_preferences: {},
};

function normalizeDigest(value: unknown): DigestMode {
  return value === "Immediate" ||
    value === "Daily" ||
    value === "Weekly"
    ? value
    : "Daily";
}

function normalizePreferences(
  value: Partial<PreferenceRecord> | null | undefined,
): PreferenceRecord {
  return {
    in_app_enabled: true,
    email_enabled: value?.email_enabled ?? true,
    critical_email_only: value?.critical_email_only ?? true,
    digest_mode: normalizeDigest(value?.digest_mode),
    source_preferences:
      value?.source_preferences &&
      typeof value.source_preferences === "object"
        ? value.source_preferences
        : {},
    updated_at: value?.updated_at ?? null,
  };
}

export async function GET() {
  const access = await resolveServerAccess();

  if (!access.ok) {
    return accessFailureResponse(access);
  }

  const resolved = access.context;
  const { data, error } = await resolved.admin
    .from("notification_preferences")
    .select(
      "in_app_enabled,email_enabled,critical_email_only,digest_mode,source_preferences,updated_at",
    )
    .eq("department_id", resolved.departmentId)
    .eq("user_id", resolved.user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    preferences: normalizePreferences(
      data as Partial<PreferenceRecord> | null,
    ),
  });
}

export async function PUT(request: NextRequest) {
  const access = await resolveServerAccess();

  if (!access.ok) {
    return accessFailureResponse(access);
  }

  const resolved = access.context;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  const { data: existing, error: existingError } = await resolved.admin
    .from("notification_preferences")
    .select(
      "in_app_enabled,email_enabled,critical_email_only,digest_mode,source_preferences,updated_at",
    )
    .eq("department_id", resolved.departmentId)
    .eq("user_id", resolved.user.id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json(
      { error: existingError.message },
      { status: 500 },
    );
  }

  const previous = normalizePreferences(
    existing as Partial<PreferenceRecord> | null,
  );

  const next: PreferenceRecord = {
    in_app_enabled: true,
    email_enabled: body.email_enabled === true,
    critical_email_only: body.critical_email_only !== false,
    digest_mode: normalizeDigest(body.digest_mode),
    source_preferences:
      body.source_preferences &&
      typeof body.source_preferences === "object" &&
      !Array.isArray(body.source_preferences)
        ? (body.source_preferences as Record<string, boolean>)
        : previous.source_preferences,
  };

  const changed =
    existing === null ||
    previous.email_enabled !== next.email_enabled ||
    previous.critical_email_only !== next.critical_email_only ||
    previous.digest_mode !== next.digest_mode ||
    JSON.stringify(previous.source_preferences) !==
      JSON.stringify(next.source_preferences);

  if (!changed) {
    return NextResponse.json({ ok: true, unchanged: true, preferences: next });
  }

  const updatedAt = new Date().toISOString();
  const { error: saveError } = await resolved.admin
    .from("notification_preferences")
    .upsert(
      {
        department_id: resolved.departmentId,
        user_id: resolved.user.id,
        ...next,
        updated_at: updatedAt,
      },
      { onConflict: "department_id,user_id" },
    );

  if (saveError) {
    return NextResponse.json(
      { error: saveError.message },
      { status: 500 },
    );
  }

  const { error: auditError } = await resolved.admin
    .from("audit_events")
    .insert({
      department_id: resolved.departmentId,
      actor_user_id: resolved.user.id,
      action: "notification_preferences_updated",
      entity_type: "notification_preferences",
      entity_id: resolved.user.id,
      summary: "Updated personal email notification preferences.",
      previous_value: {
        email_enabled: previous.email_enabled,
        critical_email_only: previous.critical_email_only,
        digest_mode: previous.digest_mode,
        source_preferences: previous.source_preferences,
      },
      new_value: {
        email_enabled: next.email_enabled,
        critical_email_only: next.critical_email_only,
        digest_mode: next.digest_mode,
        source_preferences: next.source_preferences,
      },
    });

  if (auditError) {
    let rollbackError: { message?: string } | null = null;

    if (existing) {
      const { error } = await resolved.admin
        .from("notification_preferences")
        .upsert(
          {
            department_id: resolved.departmentId,
            user_id: resolved.user.id,
            ...previous,
            updated_at: previous.updated_at ?? updatedAt,
          },
          { onConflict: "department_id,user_id" },
        );

      rollbackError = error;
    } else {
      const { error } = await resolved.admin
        .from("notification_preferences")
        .delete()
        .eq("department_id", resolved.departmentId)
        .eq("user_id", resolved.user.id);

      rollbackError = error;
    }

    return NextResponse.json(
      {
        error: rollbackError
          ? "Preference audit failed and the prior settings could not be fully restored."
          : "Preference audit failed. The prior settings were restored.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    preferences: {
      ...next,
      updated_at: updatedAt,
    },
  });
}
