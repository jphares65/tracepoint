export function verifyLedger(files, rows) {
  const byVersion = new Map(files.map((file) => [file.version, file]));
  for (const row of rows) {
    const file = byVersion.get(Number(row.version));
    if (!file || file.filename !== row.filename || file.sha256 !== row.content_sha256)
      throw new Error(`MIGRATION_DRIFT: recorded migration ${row.version} does not exactly match the repository (repository filename ${file?.filename ?? "missing"}, SHA-256 ${file?.sha256 ?? "missing"}; ledger filename ${row.filename}, SHA-256 ${row.content_sha256}).`);
  }
}
