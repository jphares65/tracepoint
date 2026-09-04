import pg from "pg";

const expectedHost = "db.wztqqqashilusoppddxi.supabase.co";
const connectionString = process.env.TRACEPOINT_STAGING_DB_URL;
if (!connectionString) throw new Error("TRACEPOINT_STAGING_DB_URL is unavailable.");
const parsed = new URL(connectionString);
if (parsed.hostname !== expectedHost) {
  throw new Error("Staging database host mismatch; verification refused.");
}

const client = new pg.Client({
  // Supabase direct database endpoints currently present a self-signed chain.
  // Pinning the exact project host above prevents accidental cross-project use;
  // TLS remains required even though the platform certificate is not CA-valid.
  connectionString: (() => {
    parsed.searchParams.delete("sslmode");
    return parsed.toString();
  })(),
  ssl: { rejectUnauthorized: false },
});
try {
  await client.connect();
  const requiredTables = [
    "profiles", "departments", "department_memberships",
    "equipment_types", "equipment_assets", "equipment_asset_assignments",
    "range_days", "range_day_drills", "fleet_vehicles",
    "notification_events", "training_certifications", "agency_training_events",
  ];
  const tables = await client.query(
    "select tablename from pg_tables where schemaname = 'public' and tablename = any($1)",
    [requiredTables],
  );
  const found = new Set(tables.rows.map(({ tablename }) => tablename));
  const missingTables = requiredTables.filter((table) => !found.has(table));
  const { rows: [checks] } = await client.query(`
    select
      (select count(*)::int from supabase_migrations.schema_migrations) as migration_count,
      exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'equipment_types_department_normalized_name_unique') as equipment_type_unique,
      exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'equipment_types' and column_name = 'is_active') as equipment_type_archive,
      exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'range_day_drills' and policyname = 'range_day_drills_delete_managers') as range_drill_rls,
      exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'equipment_asset_assignments' and policyname = 'equipment_assignment_history_select_scoped') as equipment_history_rls,
      exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'certification_types' and policyname = 'department members can view certification types') as certification_rls
  `);
  const failed = Object.entries(checks)
    .filter(([key, value]) => key !== "migration_count" && value !== true)
    .map(([key]) => key);
  if (checks.migration_count !== 56 || missingTables.length || failed.length) {
    throw new Error("Focused staging schema verification failed.");
  }
  console.log(JSON.stringify({ host: expectedHost, missingTables, ...checks }));
} finally {
  await client.end().catch(() => {});
}
