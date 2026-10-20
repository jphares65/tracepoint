// In-memory PostgREST-like query builder. Supports the subset used by the copied routes.
// Optional `policy(table, op, ctx)` simulates RLS: return false => select hides rows / update+delete affect 0 rows / insert errors.
type Row = Record<string, any>;
export function createMockDb(tables: Record<string, Row[]>, opts: { policy?: (table: string, op: string) => boolean } = {}) {
  const log: any[] = [];
  const allowed = (t: string, op: string) => (opts.policy ? opts.policy(t, op) : true);
  function from(table: string) {
    tables[table] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: any = null; let single: "one" | "maybe" | null = null; let limitN: number | null = null; let returning = false;
    const b: any = {
      select() { returning = true; return b; },
      eq(c: string, v: any) { filters.push((r) => String(r[c]) === String(v)); return b; },
      neq(c: string, v: any) { filters.push((r) => r[c] !== v); return b; },
      is(c: string, v: any) { filters.push((r) => (r[c] ?? null) === v); return b; },
      in(c: string, vs: any[]) { filters.push((r) => vs.includes(r[c])); return b; },
      not(c: string, o: string, v: any) {
        if (o === "in") { const vals = String(v).replace(/[()"]/g, "").split(","); filters.push((r) => !vals.includes(r[c])); }
        else if (o === "is") filters.push((r) => (r[c] ?? null) !== null);
        return b;
      },
      or(expr: string) {
        const parts = expr.split(",").map((p) => { const [c, o, ...rest] = p.split("."); return { c, o, v: rest.join(".") }; });
        filters.push((r) => parts.some(({ c, o, v }) => o === "eq" ? String(r[c]) === v : false));
        return b;
      },
      order() { return b; },
      limit(n: number) { limitN = n; return b; },
      maybeSingle() { single = "maybe"; return b; },
      single() { single = "one"; return b; },
      insert(p: any) { op = "insert"; payload = p; return b; },
      update(p: any) { op = "update"; payload = p; return b; },
      delete() { op = "delete"; return b; },
      then(res: any, rej: any) { return Promise.resolve(run()).then(res, rej); },
    };
    function run() {
      const rows = tables[table];
      if (op === "insert") {
        if (!allowed(table, "insert")) { log.push({ table, op, denied: true }); return { data: null, error: { code: "42501", message: `new row violates row-level security policy for table "${table}"` } }; }
        const list = (Array.isArray(payload) ? payload : [payload]).map((p: Row) => ({ id: p.id ?? `${table}-${rows.length + 1}`, ...p }));
        rows.push(...list); log.push({ table, op, rows: list });
        return { data: single ? list[0] : list, error: null };
      }
      const vis = allowed(table, op === "select" ? "select" : op);
      let matched = vis ? rows.filter((r) => filters.every((f) => f(r))) : [];
      if (limitN !== null) matched = matched.slice(0, limitN);
      if (op === "update") { for (const r of matched) Object.assign(r, payload); log.push({ table, op, payload, affected: matched.length }); }
      if (op === "delete") { for (const r of matched) rows.splice(rows.indexOf(r), 1); log.push({ table, op, affected: matched.length }); }
      if (single === "one") return matched.length === 1 ? { data: matched[0], error: null } : { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
      if (single === "maybe") return matched.length > 1 ? { data: null, error: { code: "PGRST116", message: "multiple rows" } } : { data: matched[0] ?? null, error: null };
      return { data: op === "select" || returning ? matched : null, error: null };
    }
    return b;
  }
  return { from, log, tables };
}
export function ctx(admin: any, over: Record<string, any> = {}) {
  return { ok: true, context: { admin, db: admin, departmentId: "dept-1", user: { id: "user-1" }, userId: "user-1", permissions: [], roleCodes: [], enabledFeatures: ["fleet", "equipment_readiness"], isSuperAdmin: false, isSupportMode: false, ...over } };
}
