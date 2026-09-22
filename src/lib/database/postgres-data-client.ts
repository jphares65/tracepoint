import type { Pool } from "pg";
import { withPostgresAuthorization } from "./postgres-authorization-core.ts";

type Operation = "select" | "insert" | "update" | "delete" | "upsert";
type Filter = { column: string; operator: string; value: unknown };
type Result<T = unknown> = { data: T | null; error: null | { message: string; code?: string }; count: number | null; status: number; statusText: string };
type Relation = { alias: string; table: string; local: string; foreign: string; cardinality: "one" | "many" };

const identifier = /^[a-z][a-z0-9_]*$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const jsonColumns = new Set([
  "ai_migration_workspaces.state", "audit_events.details", "audit_events.new_value", "audit_events.previous_value",
  "fleet_rules.inspection_checklist", "fleet_vehicle_inspections.checklist", "notification_preferences.source_preferences",
  "personal_rifles.armorer_checklist", "personal_rifle_status_history.metadata", "pilot_ammunition_workspaces.workspace",
  "pilot_range_workspaces.workspace", "pilot_remediation_workspaces.remediations", "range_days.outline",
]);
const relations: Record<string, Relation> = {
  "agency_training_events.agency_training_courses": { alias: "agency_training_courses", table: "agency_training_courses", local: "course_id", foreign: "id", cardinality: "one" },
  "agency_training_events.agency_training_attendees": { alias: "agency_training_attendees", table: "agency_training_attendees", local: "id", foreign: "event_id", cardinality: "many" },
  "agency_training_events.agency_training_event_instructors": { alias: "agency_training_event_instructors", table: "agency_training_event_instructors", local: "id", foreign: "event_id", cardinality: "many" },
  "agency_training_attendees.agency_training_events": { alias: "agency_training_events", table: "agency_training_events", local: "event_id", foreign: "id", cardinality: "one" },
  "agency_training_courses.agency_training_course_aliases": { alias: "agency_training_course_aliases", table: "agency_training_course_aliases", local: "id", foreign: "course_id", cardinality: "many" },
  "agency_training_requirements.agency_training_courses": { alias: "agency_training_courses", table: "agency_training_courses", local: "course_id", foreign: "id", cardinality: "one" },
  "agency_training_certificates.agency_training_events": { alias: "agency_training_events", table: "agency_training_events", local: "event_id", foreign: "id", cardinality: "one" },
  "agency_training_certificates.departments": { alias: "departments", table: "departments", local: "department_id", foreign: "id", cardinality: "one" },
  "department_memberships.profiles": { alias: "profiles", table: "profiles", local: "user_id", foreign: "id", cardinality: "one" },
  "department_memberships.departments": { alias: "departments", table: "departments", local: "department_id", foreign: "id", cardinality: "one" },
  "ammunition_transactions.ammunition_lots": { alias: "lot", table: "ammunition_lots", local: "lot_id", foreign: "id", cardinality: "one" },
  "ammunition_reconciliation_items.ammunition_lots": { alias: "lot", table: "ammunition_lots", local: "lot_id", foreign: "id", cardinality: "one" },
  "firearm_inspections.firearms": { alias: "firearm", table: "firearms", local: "firearm_id", foreign: "id", cardinality: "one" },
  "firearm_inspections.firearm_inspection_items": { alias: "items", table: "firearm_inspection_items", local: "id", foreign: "inspection_id", cardinality: "many" },
};

function quote(value: string) {
  if (!identifier.test(value)) throw new Error("Unsupported PostgreSQL identifier.");
  return `"${value}"`;
}

function splitTopLevel(value: string) {
  const output: string[] = [];
  let depth = 0, start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "(") depth++;
    else if (value[index] === ")") depth--;
    else if (value[index] === "," && depth === 0) { output.push(value.slice(start, index).trim()); start = index + 1; }
    if (depth < 0) throw new Error("Invalid PostgreSQL select expression.");
  }
  if (depth !== 0) throw new Error("Invalid PostgreSQL select expression.");
  output.push(value.slice(start).trim());
  return output.filter(Boolean);
}

function columns(value: string, alias: string) {
  const trimmed = value.trim();
  if (trimmed === "*") return `${alias}.*`;
  return splitTopLevel(trimmed).map(column => `${alias}.${quote(column)}`).join(",");
}

function normalizeFilterValue(operator: string, value: unknown) {
  if ((operator === "in" || operator === "not.in") && typeof value === "string") {
    const match = value.match(/^\((.*)\)$/);
    if (!match) throw new Error("Invalid PostgreSQL IN filter.");
    return match[1].split(",").map(item => item.trim().replace(/^\"|\"$/g, ""));
  }
  return value;
}

function filterClause(column: string, filter: Filter, values: unknown[]) {
  const value = normalizeFilterValue(filter.operator, filter.value);
  if (filter.operator === "is") {
    if (value === null) return `${column} is null`;
    if (value === true) return `${column} is true`;
    if (value === false) return `${column} is false`;
    throw new Error("Unsupported PostgreSQL IS filter.");
  }
  if (filter.operator === "not.is" && value === null) return `${column} is not null`;
  if (filter.operator === "in" || filter.operator === "not.in") {
    if (!Array.isArray(value) || value.length === 0) return filter.operator === "in" ? "false" : "true";
    values.push(value);
    return filter.operator === "in" ? `${column}=any($${values.length})` : `${column}<>all($${values.length})`;
  }
  const operators: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" };
  const operator = operators[filter.operator];
  if (!operator) throw new Error("Unsupported PostgreSQL filter operator.");
  values.push(value);
  return `${column} ${operator} $${values.length}`;
}

function relationFor(base: string, expression: string) {
  const match = expression.match(/^\s*(?:([a-z][a-z0-9_]*):)?([a-z][a-z0-9_]*)(?:![a-z0-9_]+)?\s*\(([\s\S]*)\)\s*$/);
  if (!match) return null;
  const selectedAlias = match[1] ?? match[2];
  const relation = relations[`${base}.${match[2]}`] ?? relations[`${base}.${selectedAlias}`];
  if (!relation) throw new Error(`Unsupported PostgreSQL relation ${base}.${match[2]}.`);
  return { ...relation, alias: selectedAlias, selected: match[3], inner: expression.includes("!inner") };
}

function selectSql(table: string, selection: string, relatedFilters: Filter[], values: unknown[]) {
  const expressions: string[] = [];
  const inner: string[] = [];
  const matched = new Set<Filter>();
  for (const token of splitTopLevel(selection || "*")) {
    const relation = relationFor(table, token);
    if (!relation) { expressions.push(token === "*" ? "t.*" : `t.${quote(token)}`); continue; }
    const projected = columns(relation.selected, "r");
    const correlated = `r.${quote(relation.foreign)}=t.${quote(relation.local)}`;
    const conditions = relatedFilters.filter(filter => {
      const prefix = filter.column.split(".")[0];
      return prefix === relation.alias || prefix === relation.table;
    }).map(filter => {
      matched.add(filter);
      const column = filter.column.slice(filter.column.indexOf(".") + 1);
      return filterClause(`r.${quote(column)}`, filter, values);
    });
    const relationWhere = [correlated, ...conditions].join(" and ");
    expressions.push(relation.cardinality === "one"
      ? `(select row_to_json(q) from (select ${projected} from public.${quote(relation.table)} r where ${relationWhere} limit 1) q) as ${quote(relation.alias)}`
      : `coalesce((select jsonb_agg(row_to_json(q)) from (select ${projected} from public.${quote(relation.table)} r where ${relationWhere}) q),'[]'::jsonb) as ${quote(relation.alias)}`);
    if (relation.inner) inner.push(`exists(select 1 from public.${quote(relation.table)} r where ${relationWhere})`);
  }
  if (matched.size !== relatedFilters.length) throw new Error("Related-table filters require a selected relation.");
  return { projection: expressions.join(","), inner };
}

function safeError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : undefined;
  return { message: "PostgreSQL data operation failed.", ...(code ? { code } : {}) };
}

function databaseValue(table:string,column:string,value:unknown){
  return jsonColumns.has(`${table}.${column}`)&&value!==null&&typeof value==="object"?JSON.stringify(value):value;
}

export class PostgresDataClient {
  private readonly pool: Pool;
  readonly subjectId: string;
  readonly departmentId: string;
  private readonly systemTables: ReadonlySet<string> | null;
  private readonly supportMode: boolean;

  constructor(pool: Pool, subjectId: string, departmentId: string, systemTables: ReadonlySet<string> | null = null, supportMode = false) {
    if (!uuid.test(subjectId) || !uuid.test(departmentId)) throw new Error("Valid PostgreSQL request identity is required.");
    this.pool = pool;
    this.subjectId = subjectId;
    this.departmentId = departmentId;
    this.systemTables = systemTables;
    this.supportMode = supportMode;
  }

  static forNotificationDispatch(pool: Pool) {
    return new PostgresDataClient(pool, "00000000-0000-4000-8000-000000000000", "00000000-0000-4000-8000-000000000000", new Set(["notification_email_queue", "notification_events"]));
  }

  from(table: string) {
    if (this.systemTables && !this.systemTables.has(table)) throw new Error("Notification dispatcher table access rejected.");
    return new PostgresQueryBuilder(this, table);
  }

  async execute(text: string, values: readonly unknown[]) {
    if (this.systemTables) return this.pool.query(text, [...values]) as unknown as Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
    return withPostgresAuthorization(this.pool, { subjectId: this.subjectId, departmentId: this.departmentId, supportMode: this.supportMode }, async client => client.query(text, values) as Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>);
  }

  async rpc(name: string, args: Record<string, unknown> = {}): Promise<Result> {
    try {
      if (this.systemTables) throw new Error("Notification dispatcher RPC access rejected.");
      const entries = Object.entries(args);
      const call = entries.map(([key], index) => `${quote(key)} => $${index + 1}`).join(",");
      const result = await this.execute(`select * from public.${quote(name)}(${call})`, entries.map(([, value]) => value));
      let data: unknown = result.rows;
      if (result.rows.length === 1 && Object.keys(result.rows[0]).length === 1) data = Object.values(result.rows[0])[0];
      return { data, error: null, count: null, status: 200, statusText: "OK" };
    } catch (error) {
      return { data: null, error: safeError(error), count: null, status: 400, statusText: "Bad Request" };
    }
  }
}

class PostgresQueryBuilder implements PromiseLike<Result> {
  private readonly client: PostgresDataClient;
  private readonly table: string;
  private operation: Operation = "select";
  private selection: string | null = null;
  private payload: unknown;
  private filters: Filter[] = [];
  private orGroups: string[] = [];
  private ordering: Array<{ column: string; ascending: boolean; nullsFirst?: boolean }> = [];
  private maximum: number | null = null;
  private offset: number | null = null;
  private mode: "many" | "single" | "maybeSingle" = "many";
  private countExact = false;
  private head = false;
  private conflictColumns: string[] = [];
  private ignoreDuplicates = false;

  constructor(client: PostgresDataClient, table: string) {
    quote(table);
    this.client = client;
    this.table = table;
  }

  select(selection = "*", options?: { count?: string; head?: boolean }) { this.selection = selection; this.countExact = options?.count === "exact"; this.head = options?.head === true; return this; }
  insert(payload: unknown) { this.operation = "insert"; this.payload = payload; return this; }
  update(payload: unknown) { this.operation = "update"; this.payload = payload; return this; }
  delete() { this.operation = "delete"; return this; }
  upsert(payload: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }) { this.operation = "upsert"; this.payload = payload; this.conflictColumns = options?.onConflict?.split(",").map(value => value.trim()).filter(Boolean) ?? ["id"]; this.ignoreDuplicates = options?.ignoreDuplicates === true; return this; }
  eq(column: string, value: unknown) { return this.filter(column, "eq", value); }
  neq(column: string, value: unknown) { return this.filter(column, "neq", value); }
  gt(column: string, value: unknown) { return this.filter(column, "gt", value); }
  gte(column: string, value: unknown) { return this.filter(column, "gte", value); }
  lt(column: string, value: unknown) { return this.filter(column, "lt", value); }
  lte(column: string, value: unknown) { return this.filter(column, "lte", value); }
  like(column: string, value: unknown) { return this.filter(column, "like", value); }
  ilike(column: string, value: unknown) { return this.filter(column, "ilike", value); }
  is(column: string, value: unknown) { return this.filter(column, "is", value); }
  in(column: string, value: unknown[]) { return this.filter(column, "in", value); }
  not(column: string, operator: string, value: unknown) { return this.filter(column, `not.${operator}`, value); }
  or(expression: string) { this.orGroups.push(expression); return this; }
  filter(column: string, operator: string, value: unknown) { this.filters.push({ column, operator, value }); return this; }
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) { this.ordering.push({ column, ascending: options?.ascending !== false, nullsFirst: options?.nullsFirst }); return this; }
  limit(value: number) { if (!Number.isInteger(value) || value < 0 || value > 10_000) throw new Error("Invalid PostgreSQL query limit."); this.maximum = value; return this; }
  range(from: number, to: number) { if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to - from > 10_000) throw new Error("Invalid PostgreSQL query range."); this.offset = from; this.maximum = to - from + 1; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybeSingle"; return this; }

  private where(values: unknown[]) {
    const clauses = this.filters.filter(filter => !filter.column.includes(".")).map(filter => filterClause(`t.${quote(filter.column)}`, filter, values));
    for (const expression of this.orGroups) {
      const alternatives = expression.split(",").map(item => {
        const match = item.trim().match(/^([a-z][a-z0-9_]*)\.(eq|neq|gt|gte|lt|lte|like|ilike|is)\.(.+)$/);
        if (!match) throw new Error("Unsupported PostgreSQL OR filter.");
        const raw = match[3];
        const value = raw === "true" ? true : raw === "false" ? false : raw === "null" ? null : raw;
        return filterClause(`t.${quote(match[1])}`, { column: match[1], operator: match[2], value }, values);
      });
      clauses.push(`(${alternatives.join(" or ")})`);
    }
    return clauses.length ? ` where ${clauses.join(" and ")}` : "";
  }

  private payloadRows() {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
    if (!rows.length || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Invalid PostgreSQL mutation payload.");
    const keys = Object.keys(rows[0] as object);
    if (!keys.length || rows.some(row => Object.keys(row as object).length !== keys.length || keys.some(key => !(key in (row as object))))) throw new Error("PostgreSQL mutation rows must have identical columns.");
    keys.forEach(quote);
    return { rows: rows as Record<string, unknown>[], keys };
  }

  private async run(): Promise<Result> {
    try {
      const values: unknown[] = [];
      let sql: string;
      if (this.operation === "select") {
        const where = this.where(values);
        const selected = selectSql(this.table, this.selection ?? "*", this.filters.filter(filter => filter.column.includes(".")), values);
        const combined = selected.inner.length ? `${where ? `${where} and ` : " where "}${selected.inner.join(" and ")}` : where;
        const order = this.ordering.length ? ` order by ${this.ordering.map(item => `t.${quote(item.column)} ${item.ascending ? "asc" : "desc"}${item.nullsFirst === undefined ? "" : item.nullsFirst ? " nulls first" : " nulls last"}`).join(",")}` : "";
        const limit = this.maximum === null ? "" : ` limit ${this.maximum}`;
        const offset = this.offset === null ? "" : ` offset ${this.offset}`;
        sql = `select ${selected.projection}${this.countExact ? ",count(*) over()::int as __tracepoint_count" : ""} from public.${quote(this.table)} t${combined}${order}${limit}${offset}`;
      } else if (this.operation === "delete") {
        sql = `delete from public.${quote(this.table)} t${this.where(values)}${this.selection ? ` returning ${columns(this.selection, "t")}` : ""}`;
      } else if (this.operation === "update") {
        const { rows, keys } = this.payloadRows();
        if (rows.length !== 1) throw new Error("PostgreSQL update requires one value object.");
        const assignments = keys.map(key => { values.push(databaseValue(this.table,key,rows[0][key])); return `${quote(key)}=$${values.length}`; });
        sql = `update public.${quote(this.table)} t set ${assignments.join(",")}${this.where(values)}${this.selection ? ` returning ${columns(this.selection, "t")}` : ""}`;
      } else {
        const { rows, keys } = this.payloadRows();
        const tuples = rows.map(row => `(${keys.map(key => { values.push(databaseValue(this.table,key,row[key])); return `$${values.length}`; }).join(",")})`);
        let conflict = "";
        if (this.operation === "upsert") {
          this.conflictColumns.forEach(quote);
          const updates = keys.filter(key => !this.conflictColumns.includes(key)).map(key => `${quote(key)}=excluded.${quote(key)}`);
          conflict = ` on conflict(${this.conflictColumns.map(quote).join(",")}) do ${!this.ignoreDuplicates && updates.length ? `update set ${updates.join(",")}` : "nothing"}`;
        }
        sql = `insert into public.${quote(this.table)}(${keys.map(quote).join(",")}) values ${tuples.join(",")}${conflict}${this.selection ? ` returning ${columns(this.selection, this.table)}` : ""}`;
      }
      const result = await this.client.execute(sql, values);
      const count = this.countExact ? Number(result.rows[0]?.__tracepoint_count ?? 0) : null;
      if (this.countExact) result.rows.forEach(row => delete row.__tracepoint_count);
      let data: unknown = this.head || (this.operation !== "select" && this.selection === null) ? null : result.rows;
      if (this.mode !== "many") {
        if (result.rows.length === 0 && this.mode === "maybeSingle") data = null;
        else if (result.rows.length !== 1) return { data: null, error: { message: "PostgreSQL single-row result was not unique.", code: "PGRST116" }, count, status: 406, statusText: "Not Acceptable" };
        else data = result.rows[0];
      }
      return { data, error: null, count, status: 200, statusText: "OK" };
    } catch (error) {
      return { data: null, error: safeError(error), count: null, status: 400, statusText: "Bad Request" };
    }
  }

  then<TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}
