import assert from "node:assert/strict";
import test from "node:test";
import { sourceGet } from "./supabase-rest-import-core.mjs";

const url = "https://izlkwggluhlhzlumtzes.supabase.co/rest/v1/audit_events?select=*&order=id.asc&offset=0&limit=500";
const headers = { apikey: "redacted", Authorization: "Bearer redacted" };
test("source REST deadline completes and emits sanitized evidence", async () => {
  const events = [], payload = await sourceGet(async () => new Response("[]", { status: 200 }), headers, url, "audit_events", event => events.push(event), 100);
  assert.deepEqual(payload, []); assert.deepEqual(events.map(event => event.event), ["source-fetch-start", "source-fetch-complete"]); assert.ok(events.every(event => !JSON.stringify(event).includes("redacted")));
});
test("source REST deadline aborts a stalled request and fails closed", async () => {
  const events = [];
  await assert.rejects(() => sourceGet((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason))), headers, url, "audit_events", event => events.push(event), 20), /SOURCE_REST_TIMEOUT/);
  assert.equal(events.at(-1).classification, "SOURCE_REST_TIMEOUT");
});
