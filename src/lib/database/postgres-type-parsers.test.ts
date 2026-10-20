import assert from "node:assert/strict";
import test from "node:test";

import { parsePostgresContractNumber, postgresRuntimeTypes } from "./postgres-type-parsers.ts";

test("PostgreSQL numeric and int8 fields preserve the provider number contract", () => {
  assert.equal(postgresRuntimeTypes.getTypeParser(20)("26214400"), 26_214_400);
  assert.equal(postgresRuntimeTypes.getTypeParser(1700)("123.4500"), 123.45);
  assert.equal(parsePostgresContractNumber("-12.5"), -12.5);
});

test("unsafe PostgreSQL numbers fail instead of losing precision", () => {
  assert.throws(
    () => parsePostgresContractNumber("9007199254740992"),
    /exceeds the TracePoint number contract/,
  );
});

test("PostgreSQL date fields preserve the provider calendar-date text contract", () => {
  assert.equal(postgresRuntimeTypes.getTypeParser(1082)("2028-03-01"), "2028-03-01");
  assert.equal(postgresRuntimeTypes.getTypeParser(1082)("infinity"), "infinity");
});

test("PostgreSQL timestamp fields preserve the provider ISO text contract without a server time-zone shift", () => {
  const timestamptz = postgresRuntimeTypes.getTypeParser(1184);
  assert.equal(timestamptz("2026-10-20 20:55:26.123456+00"), "2026-10-20T20:55:26.123456+00:00");
  assert.equal(timestamptz("2026-10-20 20:55:26+00"), "2026-10-20T20:55:26+00:00");
  assert.equal(timestamptz("2026-10-21 02:25:26.5+05:30"), "2026-10-21T02:25:26.5+05:30");
  assert.equal(timestamptz("1849-12-31 16:07:02-07:52:58"), "1849-12-31T16:07:02-07:52:58");
  assert.equal(timestamptz("0044-03-15 12:00:00+00 BC"), "0044-03-15T12:00:00+00:00 BC");
  assert.equal(timestamptz("infinity"), "infinity");
  assert.equal(postgresRuntimeTypes.getTypeParser(1114)("2026-10-20 20:55:26.123456"), "2026-10-20T20:55:26.123456");
});

test("PostgreSQL interval fields preserve the provider text contract", () => {
  assert.equal(postgresRuntimeTypes.getTypeParser(1186)("3 days 04:00:00"), "3 days 04:00:00");
});

test("PostgreSQL date, timestamp, interval and int8 arrays preserve the provider element contract", () => {
  assert.deepEqual(postgresRuntimeTypes.getTypeParser(1182)("{2028-03-01,NULL}"), ["2028-03-01", null]);
  assert.deepEqual(postgresRuntimeTypes.getTypeParser(1185)('{"2026-10-20 20:55:26.123456+00"}'), ["2026-10-20T20:55:26.123456+00:00"]);
  assert.deepEqual(postgresRuntimeTypes.getTypeParser(1115)('{"2026-10-20 20:55:26.123456"}'), ["2026-10-20T20:55:26.123456"]);
  assert.deepEqual(postgresRuntimeTypes.getTypeParser(1187)('{"3 days"}'), ["3 days"]);
  assert.deepEqual(postgresRuntimeTypes.getTypeParser(1016)("{26214400,NULL}"), [26_214_400, null]);
  assert.throws(() => postgresRuntimeTypes.getTypeParser(1016)("{9007199254740992}"), /exceeds the TracePoint number contract/);
});
