import assert from 'node:assert/strict';import {test} from 'node:test';import {readFileSync} from 'node:fs';
import {reviewedRefreshSchema} from './refresh-schema-source.mjs';
const source=readFileSync(new URL('../supabase/migrations/202609050011_authentication_refresh_state.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
test('reviewed additive schema is stable across Windows checkout line endings',()=>{assert.equal(reviewedRefreshSchema(source).sha256,reviewedRefreshSchema('\uFEFF'+source.replaceAll('\n','\r\n')).sha256);});
test('DDL DML permission or source edits require explicit review before staging execution',()=>{for(const altered of [source+'delete from profiles;',source.replace('enable row level security','disable row level security'),source.replace('from anon,authenticated','from anon'),source.replace('24 hours','48 hours')])assert.throws(()=>reviewedRefreshSchema(altered),/differs/);});
