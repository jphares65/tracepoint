import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTransactionalSql, parseBootstrapConfiguration } from "./bootstrap-aws-postgres-target-core.mjs";

const secret = (overrides = {}) => JSON.stringify({host:"tracepoint.abc.us-east-1.rds.amazonaws.com",port:5432,username:"tracepoint_migrator",password:"m".repeat(40),dbname:"tracepoint",...overrides});
test("bootstrap configuration binds distinct secrets to one regional RDS target",()=>{
 const parsed=parseBootstrapConfiguration({AWS_REGION:"us-east-1",TRACEPOINT_DATABASE_CA_PATH:"/app/rds-ca.pem",TRACEPOINT_MIGRATOR_SECRET_JSON:secret(),TRACEPOINT_RUNTIME_DATABASE_SECRET_JSON:secret({username:"tracepoint_runtime",password:"r".repeat(40)})});
 assert.equal(parsed.runtime.username,"tracepoint_runtime");
 for(const environment of [
  {},
  {AWS_REGION:"us-east-1",TRACEPOINT_DATABASE_CA_PATH:"/ca",TRACEPOINT_MIGRATOR_SECRET_JSON:secret(),TRACEPOINT_RUNTIME_DATABASE_SECRET_JSON:secret({host:"other.abc.us-east-1.rds.amazonaws.com",username:"tracepoint_runtime",password:"r".repeat(40)})},
  {AWS_REGION:"us-east-1",TRACEPOINT_DATABASE_CA_PATH:"/ca",TRACEPOINT_MIGRATOR_SECRET_JSON:secret(),TRACEPOINT_RUNTIME_DATABASE_SECRET_JSON:secret({username:"tracepoint_runtime",password:"short"})},
 ]) assert.throws(()=>parseBootstrapConfiguration(environment));
});
test("migration normalization preserves SQL while enforcing one outer transaction",()=>{
 assert.equal(normalizeTransactionalSql("-- reason\nbegin;\nselect 1;\ncommit;","ok.sql"),"-- reason\n\nselect 1;\n");
 assert.throws(()=>normalizeTransactionalSql("select 1; commit; select 2;","bad.sql"),/nested transaction/);
});
