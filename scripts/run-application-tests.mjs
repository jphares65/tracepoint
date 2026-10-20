import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
function tests(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const name=path.join(directory,entry.name);return entry.isDirectory()?tests(name):entry.isFile()&&/\.test\.tsx?$/.test(entry.name)?[name]:[];});}
const files=tests('src').sort();if(!files.length)throw Error('No application tests found');
const concurrency=process.platform==='win32'?'1':'2';
const reportDirectory=mkdtempSync(path.join(tmpdir(),'tracepoint-test-report-'));const tapReport=path.join(reportDirectory,'report.tap');
try{
const result=spawnSync(process.execPath,['--import','tsx','--test','--test-concurrency='+concurrency,'--test-reporter=spec','--test-reporter-destination=stdout','--test-reporter=tap','--test-reporter-destination='+tapReport,...files],{stdio:'inherit'});if(result.error)throw Error('Application test process could not start');process.exitCode=result.status??1;
// A file whose setup never settles (for example embedded PostgreSQL failing to start) is reported as passing with no tests run. Treat that as a failure.
const lines=readFileSync(tapReport,'utf8').split('\n');const empty=[];
lines.forEach((line,index)=>{const file=/^# Subtest: (.+)$/.exec(line)?.[1];if(!file||!files.includes(file))return;const next=lines.slice(index+1).findIndex(candidate=>/^(# Subtest: |ok |not ok )/.test(candidate));const body=lines.slice(index+1,next<0?undefined:index+1+next);if(!body.some(candidate=>/^ {4}# Subtest: /.test(candidate)))empty.push(file);});
if(empty.length){console.error(`Test files that ran no tests:\n${empty.join('\n')}`);process.exitCode=1;}
}finally{rmSync(reportDirectory,{recursive:true,force:true});}
