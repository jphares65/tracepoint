import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { localPostgresPort } from "../../test-support/local-postgres-port.mjs";
import { postgresRuntimeTypes } from "./postgres-type-parsers.ts";

let server: EmbeddedPostgres;
let pool: pg.Pool;
let directory: string;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tracepoint-type-parsers-test-"));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "local-test-only", port, persistent: true, postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "local-test-only", database: "postgres", types: postgresRuntimeTypes });
});

after(async () => {
  await pool?.end();
  await server?.stop();
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("the runtime pool returns DATE columns as the stored calendar day in every host time zone", async () => {
  await pool.query("create table qualification_dates (id int primary key, qualification_date date, history date[], recorded_at timestamptz)");
  await pool.query("insert into qualification_dates values (1, '2026-09-14', array['2026-09-14','2024-02-29']::date[], '2026-09-14 12:00:00+00'), (2, null, null, null)");
  const previous = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      process.env.TZ = zone;
      const { rows } = await pool.query("select id, qualification_date, history, recorded_at from qualification_dates order by id");
      assert.equal(rows[0].qualification_date, "2026-09-14", zone);
      assert.deepEqual(rows[0].history, ["2026-09-14", "2024-02-29"], zone);
      assert.equal(JSON.stringify(rows[0].qualification_date), '"2026-09-14"', zone);
      // DC2: timestamptz is ISO text with its offset (the server's session zone), the same instant.
      assert.equal(typeof rows[0].recorded_at, "string", zone);
      assert.match(rows[0].recorded_at, /^2026-09-1\dT\d\d:00:00[+-]\d\d:\d\d$/, zone);
      assert.equal(new Date(rows[0].recorded_at).toISOString(), "2026-09-14T12:00:00.000Z", zone);
      assert.equal(rows[1].qualification_date, null, zone);
      assert.equal(rows[1].history, null, zone);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});
