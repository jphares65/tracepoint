type Row = Record<string, unknown>;
type Workspace = Record<string, unknown>;

export type MobileRangeAction =
  | { type: "attendance"; operationId: string; rosterEntryId: string; attended: boolean }
  | { type: "bulk-attendance"; operationId: string; attended: boolean }
  | { type: "save-score"; operationId: string; result: Row }
  | { type: "add-roster"; operationId: string; entry: Row }
  | { type: "remove-roster"; operationId: string; rosterEntryId: string }
  | { type: "add-drill"; operationId: string; drill: Row }
  | { type: "remove-drill"; operationId: string; drillId: string }
  | { type: "reorder-drills"; operationId: string; drillIds: string[] };

export type MobileRangeMutationResult =
  | { ok: true; workspace: Workspace; alreadyApplied: boolean }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

const finalStatuses = new Set(["completed", "locked", "archived"]);
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object") : [];
const id = (value: unknown) => typeof value === "string" ? value.trim() : "";
const dayId = (row: Row) => id(row.rangeDayId ?? row.range_day_id);
const clone = (workspace: unknown): Workspace => structuredClone(workspace && typeof workspace === "object" ? workspace as Workspace : {});
const canManage = (permissions: readonly string[]) => permissions.includes("administer_department") || permissions.includes("manage_range_days");
const canScore = (permissions: readonly string[]) => canManage(permissions) || permissions.includes("score_range_days") || permissions.includes("manage_qualifications");

function operationExists(workspace: Workspace, operationId: string) {
  return ["rangeRoster", "rangeDayDrills", "results"].some((key) => rows(workspace[key]).some((row) => row.mobileMutationId === operationId));
}

function authoritativePass(drill: Row, result: Row) {
  const format = id(drill.scoringFormat ?? drill.scoringMode).toLowerCase();
  if ((format === "qualification" || format === "points") && typeof drill.passingScore === "number" && typeof result.score === "number") return result.score >= drill.passingScore;
  if (format === "time" && typeof drill.passingTimeSeconds === "number" && typeof result.timeSeconds === "number") return result.timeSeconds <= drill.passingTimeSeconds;
  if (format === "hit count" && typeof drill.minimumHits === "number" && typeof result.hitCount === "number") return result.hitCount >= drill.minimumHits;
  if (format === "completion" && typeof result.completed === "boolean") return result.completed;
  if (format === "notes only") return undefined;
  return typeof result.passed === "boolean" ? result.passed : undefined;
}

export function applyMobileRangeMutation(input: {
  workspace: unknown;
  rangeDayId: string;
  permissions: readonly string[];
  action: MobileRangeAction;
}): MobileRangeMutationResult {
  const workspace = clone(input.workspace);
  const action = input.action;
  const days = rows(workspace.rangeDays);
  const day = days.find((item) => id(item.id) === input.rangeDayId);
  if (!day) return { ok: false, status: 404, error: "Range day was not found." };
  if (finalStatuses.has(id(day.status).toLowerCase()) || id(day.packetStatus ?? day.packet_status).toLowerCase() === "ready") {
    return { ok: false, status: 409, error: "This range day is finalized or locked." };
  }
  if (operationExists(workspace, action.operationId)) return { ok: true, workspace, alreadyApplied: true };

  if (action.type === "save-score") {
    if (!canScore(input.permissions)) return { ok: false, status: 403, error: "Range scoring permission is required." };
    const drills = rows(workspace.rangeDayDrills);
    const roster = rows(workspace.rangeRoster);
    const result = action.result;
    const drillId = id(result.drillId ?? result.drill_id);
    const officerId = id(result.officerId ?? result.officer_id);
    const drill = drills.find((item) => dayId(item) === input.rangeDayId && id(item.id) === drillId);
    if (!drill ||
        !roster.some((item) => dayId(item) === input.rangeDayId && id(item.officerId ?? item.officer_id) === officerId)) {
      return { ok: false, status: 403, error: "The score references a drill or officer outside this range day." };
    }
    const results = rows(workspace.results);
    const resultId = id(result.id);
    const index = results.findIndex((item) => resultId
      ? id(item.id) === resultId
      : dayId(item) === input.rangeDayId && id(item.drillId ?? item.drill_id) === drillId &&
        id(item.officerId ?? item.officer_id) === officerId && Number(item.runNumber ?? item.run_number ?? 1) === Number(result.runNumber ?? result.run_number ?? 1));
    const pass = authoritativePass(drill, result);
    const next = { ...result, rangeDayId: input.rangeDayId, passed: pass, finalPassed: pass, mobileMutationId: action.operationId };
    if (index >= 0) results[index] = { ...results[index], ...next };
    else results.push(next);
    workspace.results = results;
    return { ok: true, workspace, alreadyApplied: false };
  }

  if (!canManage(input.permissions)) return { ok: false, status: 403, error: "Range management permission is required." };
  if (action.type === "attendance") {
    const roster = rows(workspace.rangeRoster);
    const index = roster.findIndex((item) => dayId(item) === input.rangeDayId && id(item.id) === action.rosterEntryId);
    if (index < 0) return { ok: false, status: 404, error: "Roster entry was not found." };
    roster[index] = { ...roster[index], attended: action.attended, mobileMutationId: action.operationId };
    workspace.rangeRoster = roster;
  } else if (action.type === "bulk-attendance") {
    const roster = rows(workspace.rangeRoster);
    if (!roster.some((item) => dayId(item) === input.rangeDayId)) return { ok: false, status: 404, error: "The Range Day roster is empty." };
    workspace.rangeRoster = roster.map((item) => dayId(item) === input.rangeDayId
      ? { ...item, attended: action.attended, mobileMutationId: action.operationId }
      : item);
  } else if (action.type === "add-roster") {
    const roster = rows(workspace.rangeRoster);
    const officerId = id(action.entry.officerId ?? action.entry.officer_id);
    if (!officerId || roster.some((item) => dayId(item) === input.rangeDayId && id(item.officerId ?? item.officer_id) === officerId)) {
      return { ok: false, status: 409, error: "The officer is already on this range day or is invalid." };
    }
    workspace.rangeRoster = [...roster, { ...action.entry, rangeDayId: input.rangeDayId, mobileMutationId: action.operationId }];
  } else if (action.type === "remove-roster") {
    const results = rows(workspace.results);
    const roster = rows(workspace.rangeRoster);
    const entry = roster.find((item) => dayId(item) === input.rangeDayId && id(item.id) === action.rosterEntryId);
    if (!entry) return { ok: false, status: 404, error: "Roster entry was not found." };
    if (results.some((item) => dayId(item) === input.rangeDayId && id(item.officerId ?? item.officer_id) === id(entry.officerId ?? entry.officer_id))) {
      return { ok: false, status: 409, error: "Roster entries with scoring history cannot be removed." };
    }
    workspace.rangeRoster = roster.filter((item) => item !== entry);
  } else if (action.type === "add-drill") {
    const drills = rows(workspace.rangeDayDrills);
    const templateId = id(action.drill.sourceTemplateId);
    const template = rows(workspace.drillLibrary).find((item) => id(item.id) === templateId && id(item.status).toLowerCase() === "active");
    if (!id(action.drill.id) || !template || drills.some((item) => dayId(item) === input.rangeDayId && id(item.id) === id(action.drill.id))) {
      return { ok: false, status: 409, error: "The drill is already assigned or is invalid." };
    }
    workspace.rangeDayDrills = [...drills, {
      id: action.drill.id, rangeDayId: input.rangeDayId, name: template.name, category: template.category,
      description: template.description, instructions: template.instructions, scoringMode: template.defaultScoringMode,
      scoringFormat: template.scoringFormat, passingScore: template.defaultPassingScore, maxScore: template.defaultMaxScore,
      passingTimeSeconds: template.defaultPassingTimeSeconds, minimumHits: template.defaultMinimumHits,
      runCount: template.defaultRunCount ?? 1, required: template.defaultRequired, firearmType: template.firearmType,
      roundCount: template.roundCount, sourceTemplateId: template.id, sourceTemplateName: template.name,
      copiedFromLibraryAt: new Date().toISOString(), mobileMutationId: action.operationId,
    }];
  } else if (action.type === "remove-drill") {
    const drills = rows(workspace.rangeDayDrills);
    if (rows(workspace.results).some((item) => dayId(item) === input.rangeDayId && id(item.drillId ?? item.drill_id) === action.drillId)) {
      return { ok: false, status: 409, error: "Drills with scoring history cannot be removed." };
    }
    if (!drills.some((item) => dayId(item) === input.rangeDayId && id(item.id) === action.drillId)) return { ok: false, status: 404, error: "Drill was not found." };
    workspace.rangeDayDrills = drills.filter((item) => dayId(item) !== input.rangeDayId || id(item.id) !== action.drillId);
  } else {
    const drills = rows(workspace.rangeDayDrills);
    const current = drills.filter((item) => dayId(item) === input.rangeDayId);
    if (action.drillIds.length !== current.length || new Set(action.drillIds).size !== current.length || current.some((item) => !action.drillIds.includes(id(item.id)))) {
      return { ok: false, status: 400, error: "The drill order must contain each assigned drill exactly once." };
    }
    const order = new Map(action.drillIds.map((value, index) => [value, index + 1]));
    workspace.rangeDayDrills = drills.map((item) => dayId(item) === input.rangeDayId
      ? { ...item, sortOrder: order.get(id(item.id)), mobileMutationId: action.operationId }
      : item);
  }
  return { ok: true, workspace, alreadyApplied: false };
}

export function mobileRangeDaySummary(workspaceValue: unknown, rangeDayId: string) {
  const workspace = workspaceValue && typeof workspaceValue === "object" ? workspaceValue as Workspace : {};
  const roster = rows(workspace.rangeRoster).filter((item) => dayId(item) === rangeDayId);
  const drills = rows(workspace.rangeDayDrills).filter((item) => dayId(item) === rangeDayId)
    .sort((left, right) => Number(left.sortOrder ?? left.sort_order ?? 0) - Number(right.sortOrder ?? right.sort_order ?? 0));
  const results = rows(workspace.results).filter((item) => dayId(item) === rangeDayId);
  const lastResult = results.at(-1);
  return {
    rangeDay: rows(workspace.rangeDays).find((item) => id(item.id) === rangeDayId) ?? null,
    roster,
    attendance: { roster: roster.length, present: roster.filter((item) => item.attended === true).length, absent: roster.filter((item) => item.attended !== true).length, excused: 0 },
    drills,
    results,
    resume: lastResult ? { drillId: id(lastResult.drillId ?? lastResult.drill_id), runNumber: Number(lastResult.runNumber ?? lastResult.run_number ?? 1) } : null,
    malfunctions: rows(workspace.malfunctions).filter((item) => dayId(item) === rangeDayId),
  };
}
