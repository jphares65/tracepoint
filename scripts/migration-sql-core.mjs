export function normalizeMigrationSql(value) {
  return String(value).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}
