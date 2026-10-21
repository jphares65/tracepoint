import { types as pgTypes } from "pg";

const INT8_OID = 20;
const NUMERIC_OID = 1700;
// Calendar dates stay YYYY-MM-DD text, as the provider (PostgREST) returned them; pg would build a local-midnight Date.
const DATE_OID = 1082;
// Timestamps and intervals keep the provider (PostgREST) JSON text; pg would build a Date (milliseconds only,
// `timestamp` read in the server's local zone, infinity as an Infinity Date) or an interval object.
const TIMESTAMP_OID = 1114;
const TIMESTAMPTZ_OID = 1184;
const INTERVAL_OID = 1186;
const TEXT_ARRAY_OID: number = 1009;
const ARRAY_ELEMENT_OIDS: Record<number, number> = { 1016: INT8_OID, 1115: TIMESTAMP_OID, 1182: DATE_OID, 1185: TIMESTAMPTZ_OID, 1187: INTERVAL_OID };

export function parsePostgresContractNumber(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > Number.MAX_SAFE_INTEGER) {
    throw new Error("PostgreSQL numeric value exceeds the TracePoint number contract.");
  }
  return parsed;
}

// "2026-10-20 20:55:26.123456+00" -> "2026-10-20T20:55:26.123456+00:00", exactly as to_json writes it; infinity stays as text.
export function parsePostgresContractTimestamp(value: string) {
  const match = /^(\d{4,}-\d\d-\d\d) (\d\d:\d\d:\d\d(?:\.\d+)?)(?:([+-]\d\d)((?::\d\d){0,2}))?( BC)?$/.exec(value);
  if (!match) return value;
  return `${match[1]}T${match[2]}${match[3] ? match[3] + (match[4] || ":00") : ""}${match[5] ?? ""}`;
}

function contractParser(oid: number): ((value: string) => unknown) | null {
  if (oid === INT8_OID || oid === NUMERIC_OID) return parsePostgresContractNumber;
  if (oid === TIMESTAMP_OID || oid === TIMESTAMPTZ_OID) return parsePostgresContractTimestamp;
  if (oid === DATE_OID || oid === INTERVAL_OID) return (value: string) => value;
  const element = ARRAY_ELEMENT_OIDS[oid];
  if (element === undefined) return null;
  const parseElement = contractParser(element)!;
  const parseTextArray = pgTypes.getTypeParser(TEXT_ARRAY_OID, "text") as (value: string) => unknown[];
  const map = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(map) : entry === null ? null : parseElement(entry as string);
  return (value: string) => parseTextArray(value).map(map);
}

export const postgresRuntimeTypes = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    const parser = (format ?? "text") === "text" ? contractParser(oid) : null;
    return parser ?? pgTypes.getTypeParser(oid, format);
  },
};
