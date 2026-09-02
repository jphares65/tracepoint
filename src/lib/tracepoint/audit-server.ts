import "server-only";
import { createAdministrationReadRepository } from "@/lib/administration/read-repository";

const EVENT_COLUMNS = [
  "id",
  "actor_user_id",
  "action",
  "entity_type",
  "entity_id",
  "summary",
  "previous_value",
  "new_value",
  "details",
  "created_at",
].join(",");

const LEGACY_COLUMNS = [
  "id",
  "entity_type",
  "entity_id",
  "action",
  "changed_by_user_id",
  "change_note",
  "changed_fields",
  "old_values",
  "new_values",
  "created_at",
].join(",");

const EXPORT_BATCH_SIZE = 1000;

type RawAuditRow = Record<string, unknown>;

export type UnifiedAuditEvent = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  changed_by_user_id: string | null;
  change_note: string;
  changed_fields: string[];
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  created_at: string;
  source_stream: "audit_events" | "audit_log";
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStoredObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  return Object.keys(asRecord(value)).length
    ? asRecord(value)
    : { value };
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function humanizeAction(value: unknown) {
  const action = asString(value).trim();
  if (!action) return "Activity recorded";
  return action
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function changedFields(previousValue: unknown, newValue: unknown) {
  const previous = asRecord(previousValue);
  const current = asRecord(newValue);
  const keys = Array.from(
    new Set([...Object.keys(previous), ...Object.keys(current)]),
  );

  return keys.filter(
    (key) =>
      JSON.stringify(previous[key]) !== JSON.stringify(current[key]),
  );
}

function normalizeEvent(row: RawAuditRow): UnifiedAuditEvent {
  const details = asRecord(row.details);
  const previousValue = row.previous_value ?? details.previous ?? null;
  const newValue = row.new_value ?? details.current ?? details.new_value ?? null;
  const suppliedFields = Array.isArray(details.changed_fields)
    ? details.changed_fields.filter(
        (field): field is string => typeof field === "string",
      )
    : [];

  const summary =
    asString(row.summary).trim() ||
    asString(details.reason).trim() ||
    asString(details.message).trim() ||
    humanizeAction(row.action);

  return {
    id: "event:" + String(row.id),
    entity_type: asString(row.entity_type) || "unknown",
    entity_id: asString(row.entity_id) || null,
    action: asString(row.action) || "recorded",
    changed_by_user_id: asString(row.actor_user_id) || null,
    change_note: summary,
    changed_fields:
      suppliedFields.length > 0
        ? suppliedFields
        : changedFields(previousValue, newValue),
    old_values: asStoredObject(previousValue),
    new_values:
      newValue !== null && newValue !== undefined
        ? asStoredObject(newValue)
        : asStoredObject(details),
    created_at: asString(row.created_at),
    source_stream: "audit_events",
  };
}

function normalizeLegacy(row: RawAuditRow): UnifiedAuditEvent {
  return {
    id: "legacy:" + String(row.id),
    entity_type: asString(row.entity_type) || "unknown",
    entity_id: asString(row.entity_id) || null,
    action: asString(row.action) || "recorded",
    changed_by_user_id: asString(row.changed_by_user_id) || null,
    change_note:
      asString(row.change_note).trim() || humanizeAction(row.action),
    changed_fields: Array.isArray(row.changed_fields)
      ? row.changed_fields.filter(
          (field): field is string => typeof field === "string",
        )
      : changedFields(row.old_values, row.new_values),
    old_values: asStoredObject(row.old_values),
    new_values: asStoredObject(row.new_values),
    created_at: asString(row.created_at),
    source_stream: "audit_log",
  };
}

function comparableEntityType(value: string) {
  const normalized = value.toLowerCase().replace(/^public\./, "");
  return normalized.endsWith("s") ? normalized.slice(0, -1) : normalized;
}

function isPairedLegacyDuplicate(
  event: UnifiedAuditEvent,
  legacyEvents: UnifiedAuditEvent[],
) {
  if (!event.entity_id || !["insert", "update", "delete"].includes(event.action)) {
    return false;
  }

  const eventTime = Date.parse(event.created_at);
  if (!Number.isFinite(eventTime)) return false;

  return legacyEvents.some((legacy) => {
    const legacyTime = Date.parse(legacy.created_at);
    return (
      legacy.entity_id === event.entity_id &&
      legacy.changed_by_user_id === event.changed_by_user_id &&
      comparableEntityType(legacy.entity_type) ===
        comparableEntityType(event.entity_type) &&
      Number.isFinite(legacyTime) &&
      Math.abs(legacyTime - eventTime) <= 2000
    );
  });
}

function mergeAuditRows(
  eventRows: RawAuditRow[],
  legacyRows: RawAuditRow[],
  limit?: number,
) {
  const legacyEvents = legacyRows.map(normalizeLegacy);
  const canonicalEvents = eventRows
    .map(normalizeEvent)
    .filter((event) => !isPairedLegacyDuplicate(event, legacyEvents));

  const merged = [...legacyEvents, ...canonicalEvents].sort(
    (left, right) =>
      Date.parse(right.created_at) - Date.parse(left.created_at),
  );

  return typeof limit === "number" ? merged.slice(0, limit) : merged;
}

async function loadLimitedSource(
  admin: any,
  table: "audit_events" | "audit_log",
  columns: string,
  departmentId: string,
  limit: number,
) {
  try { return await createAdministrationReadRepository(admin, departmentId).listAudit(departmentId, table, columns, limit) as RawAuditRow[]; }
  catch (error) { throw new Error("Unable to load " + table + ": " + (error instanceof Error ? error.message : "Unknown error")); }
}

async function loadCompleteSource(
  admin: any,
  table: "audit_events" | "audit_log",
  columns: string,
  departmentId: string,
) {
  const rows: RawAuditRow[] = [];
  let from = 0;

  while (true) {
    let batch: RawAuditRow[];
    try { batch = await createAdministrationReadRepository(admin, departmentId).listCompleteAudit(departmentId, table, columns, from, from + EXPORT_BATCH_SIZE - 1) as RawAuditRow[]; }
    catch (error) { throw new Error("Unable to load " + table + ": " + (error instanceof Error ? error.message : "Unknown error")); }
    rows.push(...batch);

    if (batch.length < EXPORT_BATCH_SIZE) break;
    from += EXPORT_BATCH_SIZE;
  }

  return rows;
}

export async function loadAuditFeed(
  admin: any,
  departmentId: string,
  limit: number,
) {
  const [eventRows, legacyRows] = await Promise.all([
    loadLimitedSource(
      admin,
      "audit_events",
      EVENT_COLUMNS,
      departmentId,
      limit,
    ),
    loadLimitedSource(
      admin,
      "audit_log",
      LEGACY_COLUMNS,
      departmentId,
      limit,
    ),
  ]);

  return mergeAuditRows(eventRows, legacyRows, limit);
}

export async function loadCompleteAuditFeed(
  admin: any,
  departmentId: string,
) {
  const [eventRows, legacyRows] = await Promise.all([
    loadCompleteSource(
      admin,
      "audit_events",
      EVENT_COLUMNS,
      departmentId,
    ),
    loadCompleteSource(
      admin,
      "audit_log",
      LEGACY_COLUMNS,
      departmentId,
    ),
  ]);

  return mergeAuditRows(eventRows, legacyRows);
}
