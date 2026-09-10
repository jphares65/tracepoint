import { types as pgTypes } from "pg";

const INT8_OID = 20;
const NUMERIC_OID = 1700;

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
    return pgTypes.getTypeParser(oid, format);
  },
};
