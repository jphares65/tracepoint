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

test("PostgreSQL DATE fields stay calendar-date text, as PostgREST returns them", () => {
  assert.equal(postgresRuntimeTypes.getTypeParser(1082)("2026-09-14"), "2026-09-14");
  assert.deepEqual(postgresRuntimeTypes.getTypeParser(1182)("{2026-09-14,NULL,2024-02-29}"), ["2026-09-14", null, "2024-02-29"]);
  assert.ok(postgresRuntimeTypes.getTypeParser(1184)("2026-09-14 12:00:00+00") instanceof Date, "timestamptz parsing is unchanged");
});
