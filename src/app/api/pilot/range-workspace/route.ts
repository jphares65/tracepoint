import {validateWorkspaceWrite} from "@/lib/range/workspace-write-policy";
import { NextRequest, NextResponse } from "next/server";


import {
  accessFailureResponse,
  featureDisabledResponse,
  hasAnyServerPermission,
  hasServerFeature,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { createRangeReadRepository } from "@/lib/range/read-repository";

type StoredRangeDayWorkspace = {
  rangeDays?: unknown[];
  drillLibrary?: unknown[];
  rangeDayDrills?: unknown[];
  rangeRoster?: unknown[];
  results?: unknown[];
  malfunctions?: unknown[];
};

function normalizeWorkspace(value: unknown): StoredRangeDayWorkspace {
  const workspace =
    value && typeof value === "object"
      ? (value as StoredRangeDayWorkspace)
      : {};

  return {
    rangeDays: Array.isArray(workspace.rangeDays)
      ? workspace.rangeDays
      : [],
    drillLibrary: Array.isArray(workspace.drillLibrary)
      ? workspace.drillLibrary
      : [],
    rangeDayDrills: Array.isArray(workspace.rangeDayDrills)
      ? workspace.rangeDayDrills
      : [],
    rangeRoster: Array.isArray(workspace.rangeRoster)
      ? workspace.rangeRoster
      : [],
    results: Array.isArray(workspace.results)
      ? workspace.results
      : [],
    malfunctions: Array.isArray(workspace.malfunctions)
      ? workspace.malfunctions
      : [],
  };
}

export async function GET() {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const canReadWorkspace =
    hasServerFeature(resolved.context, "range_training") ||
    hasServerFeature(resolved.context, "qualifications");

  if (!canReadWorkspace) {
    return featureDisabledResponse(
      "Range & Training and Qualifications",
    );
  }
  const {
    admin,
    departmentId,
  } = resolved.context;

  try {
    const data = await createRangeReadRepository(admin, departmentId).getWorkspace(departmentId);

    return NextResponse.json({
      departmentId,
      canManage: hasAnyServerPermission(resolved.context, ["manage_range_days"]),
      workspace: data.workspace,
      qualificationStandards: data.qualificationStandards,
      updatedAt: data.updatedAt,
      updatedByUserId: data.updatedByUserId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The pilot range workspace could not be loaded.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const featureError = requireServerFeature(
    resolved.context,
    "range_training",
    "Range & Training",
  );

  if (featureError) {
    return featureError;
  }
  const {
    admin,
    user,
    departmentId,
  } = resolved.context;

  const canManage=hasAnyServerPermission(resolved.context,["manage_range_days"]);
  const canScore=hasAnyServerPermission(resolved.context,["score_range_days"]);
  if(!canManage&&!canScore)return NextResponse.json({error:"Range administration or scoring permission is required."},{status:403});
  const body = (await request.json().catch(() => ({}))) as {
    workspace?: unknown;
  };

  const workspace = normalizeWorkspace(body.workspace);

  try {
    const previous=await admin.from("pilot_range_workspaces").select("workspace,updated_at").eq("department_id",departmentId).maybeSingle();
    if(previous.error)throw new Error("The range workspace could not be loaded for validation.");
    const policy=validateWorkspaceWrite({canManage,canScore,previous:previous.data?.workspace,next:workspace,departmentId});
    if(!policy.ok)return NextResponse.json({error:policy.error},{status:policy.status});
    const updatedAt=new Date(Math.max(Date.now(),previous.data ? Date.parse(previous.data.updated_at)+1 : 0)).toISOString();
    const payload={department_id:departmentId,workspace,updated_by_user_id:user.id,updated_at:updatedAt};
    const write=previous.data
      ? await admin.from("pilot_range_workspaces").update(payload).eq("department_id",departmentId).eq("updated_at",previous.data.updated_at).select("department_id").maybeSingle()
      : await admin.from("pilot_range_workspaces").insert(payload).select("department_id").maybeSingle();
    if(write.error?.code==="23505" || (!write.error&&!write.data))return NextResponse.json({error:"The workspace changed during validation. Reload before saving."},{status:409});
    const error=write.error;

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      ok: true,
      departmentId,
      counts: {
        rangeDays: workspace.rangeDays?.length ?? 0,
        drillLibrary: workspace.drillLibrary?.length ?? 0,
        rangeDayDrills: workspace.rangeDayDrills?.length ?? 0,
        rangeRoster: workspace.rangeRoster?.length ?? 0,
        results: workspace.results?.length ?? 0,
        malfunctions: workspace.malfunctions?.length ?? 0,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The pilot range workspace could not be saved.",
      },
      { status: 500 },
    );
  }
}






