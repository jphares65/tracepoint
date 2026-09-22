type DataError = { message: string; code?: string };
type DataResult = { data: unknown; error: DataError | null };
type Filter = { kind: "eq" | "in"; column: string; value: unknown };
type Order = { column: string; ascending: boolean };

class SettingsBrowserQuery implements PromiseLike<DataResult> {
  private operation: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private fields = "*";
  private payload: unknown;
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private mode: "many" | "single" | "maybeSingle" = "many";
  private options: Record<string, unknown> = {};

  constructor(private readonly table: string) {}
  select(fields = "*") { this.fields = fields; return this; }
  insert(payload: unknown) { this.operation = "insert"; this.payload = payload; return this; }
  update(payload: unknown) { this.operation = "update"; this.payload = payload; return this; }
  upsert(payload: unknown, options: Record<string, unknown> = {}) { this.operation = "upsert"; this.payload = payload; this.options = options; return this; }
  delete() { this.operation = "delete"; return this; }
  eq(column: string, value: unknown) { this.filters.push({ kind: "eq", column, value }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ kind: "in", column, value }); return this; }
  order(column: string, options: { ascending?: boolean } = {}) { this.orders.push({ column, ascending: options.ascending !== false }); return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybeSingle"; return this; }
  async execute(): Promise<DataResult> {
    try {
      const response = await fetch("/api/settings/data", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: this.table, operation: this.operation, fields: this.fields, payload: this.payload, filters: this.filters, orders: this.orders, mode: this.mode, options: this.options }),
      });
      const result = await response.json().catch(() => ({}));
      return response.ok
        ? { data: result.data ?? null, error: null }
        : { data: null, error: { message: typeof result.error === "string" ? result.error : "The settings operation failed.", code: typeof result.code === "string" ? result.code : undefined } };
    } catch {
      return { data: null, error: { message: "The settings service is unavailable." } };
    }
  }
  then<TResult1 = DataResult, TResult2 = never>(onfulfilled?: ((value: DataResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export function createSettingsBrowserClient() {
  return {
    from(table: string) { return new SettingsBrowserQuery(table); },
    async rpc(name: string, args: Record<string, unknown>) {
      try {
        const response = await fetch("/api/settings/data", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rpc: name, args }),
        });
        const result = await response.json().catch(() => ({}));
        return response.ok ? { data: result.data ?? null, error: null } : { data: null, error: { message: typeof result.error === "string" ? result.error : "The settings command failed.", code: result.code } };
      } catch {
        return { data: null, error: { message: "The settings service is unavailable." } };
      }
    },
  };
}
