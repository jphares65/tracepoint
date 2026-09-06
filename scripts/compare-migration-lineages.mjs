import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const digest=value=>createHash('sha256').update(value).digest('hex');
function filesByVersion(files){
 const result=new Map();for(const file of files){const match=/^supabase\/migrations\/(\d+)_.+\.sql$/.exec(file.path);if(!match||result.has(match[1]))throw Error('Invalid or duplicate source migration identifier.');result.set(match[1],{version:match[1],path:file.path,sha256:digest(file.bytes)});}return result;
}
function ledgerByVersion(rows){
 if(rows===undefined)return null;if(!Array.isArray(rows))throw Error('Ledger must contain metadata rows only.');const result=new Map();
 for(const row of rows){if(!/^\d+$/.test(row.version)||result.has(row.version)||row.statements!==null&&row.statements!==undefined&&(!Array.isArray(row.statements)||row.statements.some(x=>typeof x!=='string')))throw Error('Invalid or duplicate ledger metadata.');
  result.set(row.version,{version:row.version,statementsSha256:Array.isArray(row.statements)&&row.statements.length?digest(JSON.stringify(row.statements)):null});
 }return result;
}
// Exact Git blob bytes determine source equality. No whitespace, comments or
// SQL normalization can hide changed statements. Ledger hashes use a separate
// JSON-array encoding and are never falsely compared with source-file hashes.
export function compareMigrationLineages({mainFiles,awsFiles,productionLedger,stagingLedger}){
 const main=filesByVersion(mainFiles),aws=filesByVersion(awsFiles),production=ledgerByVersion(productionLedger),staging=ledgerByVersion(stagingLedger);
 const report={sameSql:[],mainOnly:[],awsOnly:[],collisions:[],ledgerContentConflicts:[],unverifiedLedgerVersions:{production:[],staging:[]},ledgerOnly:{production:[],staging:[]},ledgersAvailable:!!production&&!!staging};
 for(const version of [...new Set([...main.keys(),...aws.keys()])].sort()){
  const a=main.get(version),b=aws.get(version),p=production?.get(version),s=staging?.get(version);
  if(p?.statementsSha256&&s?.statementsSha256&&p.statementsSha256!==s.statementsSha256)report.ledgerContentConflicts.push({version,productionStatementsSha256:p.statementsSha256,stagingStatementsSha256:s.statementsSha256});
  const applied={productionApplied:production?!!p:null,stagingApplied:staging?!!s:null};
  if(!a)report.awsOnly.push({...b,...applied});else if(!b)report.mainOnly.push({...a,...applied});else if(a.sha256===b.sha256)report.sameSql.push({version,sha256:a.sha256,...applied});
  else report.collisions.push({version,main:a,aws:b,...applied,productionStatementsSha256:p?.statementsSha256??null,stagingStatementsSha256:s?.statementsSha256??null,ledgerStatementsEqual:p?.statementsSha256&&s?.statementsSha256?p.statementsSha256===s.statementsSha256:null,requiredAction:'Preserve production-applied identifier and historical ledger provenance; write unique forward-only reconciliation and prove both upgrade paths.'});
 }
 if(production){report.ledgerOnly.production=[...production.keys()].filter(v=>!main.has(v));report.unverifiedLedgerVersions.production=[...production.values()].filter(v=>!v.statementsSha256).map(v=>v.version);}
 if(staging){report.ledgerOnly.staging=[...staging.keys()].filter(v=>!aws.has(v));report.unverifiedLedgerVersions.staging=[...staging.values()].filter(v=>!v.statementsSha256).map(v=>v.version);}
 report.safeToIntegrate=report.ledgersAvailable&&report.collisions.length===0&&report.ledgerContentConflicts.length===0&&Object.values(report.ledgerOnly).every(v=>v.length===0)&&Object.values(report.unverifiedLedgerVersions).every(v=>v.length===0);
 report.executionAuthorized=false;
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const git=args=>execFileSync('git',['-c','safe.directory='+process.cwd(),...args],{stdio:['ignore','pipe','pipe']});
  const main=git(['rev-parse','origin/main']).toString().trim(),aws=git(['rev-parse','HEAD']).toString().trim();
  const read=sha=>git(['ls-tree','-r','--name-only',sha,'--','supabase/migrations']).toString().trim().split(/\r?\n/).filter(p=>p.endsWith('.sql')).map(path=>({path,bytes:git(['show',sha+':'+path])}));
  const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
  const load=name=>{const p=option(name);return p?JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,'')):undefined;};
  const report={mainCommit:main,awsCommit:aws,checkedAtUTC:new Date().toISOString(),...compareMigrationLineages({mainFiles:read(main),awsFiles:read(aws),productionLedger:load('--production-ledger'),stagingLedger:load('--staging-ledger')})};
  const output=option('--output');if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,sameSqlCount:report.sameSql.length,sameSql:undefined},null,2));
 }catch{console.error('Migration lineage comparison failed; ledger statements and SQL contents suppressed.');process.exitCode=1;}
}
