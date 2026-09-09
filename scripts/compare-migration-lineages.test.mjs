import assert from 'node:assert/strict';import {test} from 'node:test';import {compareMigrationLineages} from './compare-migration-lineages.mjs';
const file=(version,sql,name='schema')=>({path:`supabase/migrations/${version}_${name}.sql`,bytes:Buffer.from(sql)});
test('same version with different SQL remains a collision even when both ledgers mark it applied',()=>{
 const r=compareMigrationLineages({mainFiles:[file('202609050001','create table a(id int);')],awsFiles:[file('202609050001','create table b(id int);')],productionLedger:[{version:'202609050001',statements:['create table a(id int);']}],stagingLedger:[{version:'202609050001',statements:['create table b(id int);']}]});
 assert.equal(r.collisions.length,1);assert.equal(r.collisions[0].productionApplied,true);assert.equal(r.collisions[0].stagingApplied,true);assert.equal(r.collisions[0].ledgerStatementsEqual,false);assert.equal(r.safeToIntegrate,false);
});
test('comments and line-ending differences are not silently considered equivalent SQL',()=>{
 for(const sql of ['select 1; -- different','select 1;\r\n']){const r=compareMigrationLineages({mainFiles:[file('1','select 1;\n')],awsFiles:[file('1',sql)]});assert.equal(r.collisions.length,1);}
});
test('missing or orphan ledger evidence blocks integration without inventing equivalence',()=>{
 const shared=[file('1','select 1;')];let r=compareMigrationLineages({mainFiles:shared,awsFiles:shared});assert.equal(r.sameSql.length,1);assert.equal(r.safeToIntegrate,false);
 r=compareMigrationLineages({mainFiles:shared,awsFiles:shared,productionLedger:[{version:'2',statements:null}],stagingLedger:[{version:'1',statements:null}]});assert.deepEqual(r.ledgerOnly.production,['2']);assert.equal(r.safeToIntegrate,false);
});
test('unique forward migrations remain distinct and comparison never authorizes execution',()=>{
 const r=compareMigrationLineages({mainFiles:[file('1','select 1;'),file('3','select 3;')],awsFiles:[file('1','select 1;'),file('2','select 2;')],productionLedger:[{version:'1',statements:['select 1;']},{version:'3',statements:['select 3;']}],stagingLedger:[{version:'1',statements:['select 1;']},{version:'2',statements:['select 2;']}]});assert.equal(r.mainOnly[0].version,'3');assert.equal(r.awsOnly[0].version,'2');assert.equal(r.safeToIntegrate,true);assert.equal(r.executionAuthorized,false);
});
test('identical repository files cannot hide differing or absent applied SQL evidence',()=>{
 const files=[file('1','select 1;')];for(const statements of [null,[],['select 2;']]){const r=compareMigrationLineages({mainFiles:files,awsFiles:files,productionLedger:[{version:'1',statements:['select 1;']}],stagingLedger:[{version:'1',statements}]});assert.equal(r.safeToIntegrate,false);assert.equal(r.sameSql.length,1);}
});
test('duplicate source or ledger identifiers fail before comparison',()=>{
 const base={mainFiles:[file('1','a')],awsFiles:[file('1','a')]};assert.throws(()=>compareMigrationLineages({...base,mainFiles:[file('1','a'),file('1','b','other')]}),/duplicate/);assert.throws(()=>compareMigrationLineages({...base,productionLedger:[{version:'1'},{version:'1'}]}),/duplicate/);
});
