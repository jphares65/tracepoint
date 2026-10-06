import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDocumentContext } from "./context-analysis";
test("agency and date fields do not need selections",()=>assert.deepEqual(analyzeDocumentContext(["agency.name",null]).required,[]));
test("person keys require a person",()=>assert.deepEqual(analyzeDocumentContext(["person.full_name","person.badge_number"]),{required:["person"],primary:"person",inferred:[]}));
test("firearm selection derives person when safe",()=>assert.deepEqual(analyzeDocumentContext(["person.full_name","firearm.serial_number"]),{required:["firearm"],primary:"firearm",inferred:["person"]}));
