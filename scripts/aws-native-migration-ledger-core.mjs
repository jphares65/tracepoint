import { createHash } from "node:crypto";

export const FIREARM_RESTRICTED_USE_VERSION = 29;
export const FIREARM_RESTRICTED_USE_FILENAME = "029_firearm_restricted_use.sql";
export const FIREARM_RESTRICTED_USE_LF_SHA256 = "18c48ad5b51b2bd1142e04dc0948e570fcf518113bede09f8fa320fde3212d0c";
export const FIREARM_RESTRICTED_USE_CRLF_SHA256 = "26116b3dc2762be0906648382b1c7c9784838c159058105c9de76b5694e8908a";

function sha256(contents) { return createHash("sha256").update(contents).digest("hex"); }

function isHistoricalFirearmRestrictedUseLineEndingPair(file, row) {
  // Frozen staging-ledger compatibility for migration 029's historical CRLF bytes; this is not general normalization.
  return file.version === FIREARM_RESTRICTED_USE_VERSION &&
    file.filename === FIREARM_RESTRICTED_USE_FILENAME &&
    row.filename === FIREARM_RESTRICTED_USE_FILENAME &&
    file.sha256 === FIREARM_RESTRICTED_USE_LF_SHA256 &&
    sha256(file.contents) === FIREARM_RESTRICTED_USE_LF_SHA256 &&
    row.content_sha256 === FIREARM_RESTRICTED_USE_CRLF_SHA256 &&
    sha256(file.contents.replace(/\r?\n/g, "\r\n")) === FIREARM_RESTRICTED_USE_CRLF_SHA256;
}

export function verifyLedger(files, rows) {
  const byVersion = new Map(files.map((file) => [file.version, file]));
  for (const row of rows) {
    const file = byVersion.get(Number(row.version));
    if (!file || (file.filename !== row.filename || file.sha256 !== row.content_sha256) && !isHistoricalFirearmRestrictedUseLineEndingPair(file, row))
      throw new Error(`MIGRATION_DRIFT: recorded migration ${row.version} does not exactly match the repository (repository filename ${file?.filename ?? "missing"}, SHA-256 ${file?.sha256 ?? "missing"}; ledger filename ${row.filename}, SHA-256 ${row.content_sha256}).`);
  }
}
