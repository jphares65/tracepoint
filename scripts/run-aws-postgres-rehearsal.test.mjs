import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTarget} from './run-aws-postgres-rehearsal.mjs';
const valid={REHEARSAL_ACCOUNT:'559054714699',AWS_REGION:'us-east-1',REHEARSAL_RUN:'abcdef123456',PGHOST:'tp-rehearsal-abcdef123456.abcd.us-east-1.rds.amazonaws.com',PGDATABASE:'tracepoint_rehearsal',REHEARSAL_PURPOSE:'disposable-synthetic-only'};
test('only exact disposable AWS target is accepted',()=>{validateTarget(valid);for(const [key,value] of Object.entries({REHEARSAL_ACCOUNT:'265544358665',AWS_REGION:'us-west-2',REHEARSAL_RUN:'../escape',PGHOST:'db.wztqqqashilusoppddxi.supabase.co',PGDATABASE:'postgres',REHEARSAL_PURPOSE:'production'}))assert.throws(()=>validateTarget({...valid,[key]:value}));assert.throws(()=>validateTarget({...valid,PGHOST:valid.PGHOST+'.evil.test'}));});
