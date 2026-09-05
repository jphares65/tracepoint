import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
function tests(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const name=path.join(directory,entry.name);return entry.isDirectory()?tests(name):entry.isFile()&&/\.test\.tsx?$/.test(entry.name)?[name]:[];});}
const files=tests('src').sort();if(!files.length)throw Error('No application tests found');
const result=spawnSync(process.execPath,['--import','tsx','--test','--test-concurrency=2',...files],{stdio:'inherit'});if(result.error)throw Error('Application test process could not start');process.exitCode=result.status??1;
