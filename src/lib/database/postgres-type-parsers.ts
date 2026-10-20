import { types as pgTypes } from "pg";

const INT8_OID = 20;
const NUMERIC_OID = 1700;
// Calendar dates stay YYYY-MM-DD text, as the provider (PostgREST) returned them; pg would build a local-midnight Date.
const DATE_OID = 1082;

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
    if ((format ?? "text") === "text" && oid === DATE_OID) return (value: string) => value;
    return pgTypes.getTypeParser(oid, format);
  },
};
