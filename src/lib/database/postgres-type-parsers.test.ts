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
