import { types as pgTypes } from "pg";

const INT8_OID = 20;
const NUMERIC_OID = 1700;
const DATE_OID = 1082;
const DATE_ARRAY_OID = 1182;
// Not in the pg-types TypeId enum, which lists only scalar types.
const TEXT_ARRAY_OID = 1009 as Parameters<typeof pgTypes.getTypeParser>[0];

/**
 * DATE values stay yyyy-mm-dd text, as PostgREST returns them. node-postgres
 * would otherwise build a Date at the host's local midnight, which serializes
 * as a timestamp and moves the calendar day on any host not running in UTC.
 */
function parsePostgresDate(value: string) {
  return value;
}

export function parsePostgresContractNumber(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > Number.MAX_SAFE_INTEGER) {
    throw new Error("PostgreSQL numeric value exceeds the TracePoint number contract.");
  }
  return parsed;
}

export const postgresRuntimeTypes = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if ((format ?? "text") === "text" && (oid === INT8_OID || oid === NUMERIC_OID)) {
      return parsePostgresContractNumber;
    }
    if ((format ?? "text") === "text" && oid === DATE_OID) return parsePostgresDate;
    if ((format ?? "text") === "text" && oid === DATE_ARRAY_OID) return pgTypes.getTypeParser(TEXT_ARRAY_OID, "text");
    return pgTypes.getTypeParser(oid, format);
  },
};
