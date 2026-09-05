import assert from 'node:assert/strict';
import {validateTracePointRuntimeConfig} from './validate-tracepoint-runtime-config.mjs';
export const productionArchivePaths=['.dockerignore','buildspec.production-image.yml','Dockerfile','eslint.config.mjs','next.config.ts','package.json','package-lock.json','postcss.config.mjs','tsconfig.json','public','src','scripts/start-tracepoint-container.mjs','scripts/validate-tracepoint-runtime-config.mjs'];
export function validateProductionArchive(entries,tracked){
 assert.ok(entries.length>0);for(const entry of entries){assert.ok(tracked.has(entry),'Untracked archive path');assert.ok(!/(^|\/)\.env($|\.)|(^|\/)\.aws\/|(^|\/)\.git\/|(^|\/)\.github\/|(^|\/)node_modules\/|(^|\/)\.next\/|(^|\/)cdk\.out|\.tsbuildinfo$|\.(dump|sql)$|(^|\/)[^/]*(credential|secret)[^/]*$|API KEYS|integration-demo|seed-demo-fleet-equipment|\.(backup|encoding-backup)-|\.before-|\.bak($|-)/i.test(entry),'Prohibited archive path');}
 assert.ok(entries.includes('buildspec.production-image.yml'));assert.ok(!entries.includes('buildspec.staging-image.yml'));return entries.length;
}
export function validateProductionSecret(secret){
 validateTracePointRuntimeConfig({...secret,TRACEPOINT_DATA_PROVIDER:'supabase',TRACEPOINT_EMAIL_PROVIDER:'brevo',TRACEPOINT_STORAGE_PROVIDER:'supabase'});
 assert.equal(secret.CONFIGURATION_ENVIRONMENT,'production');
 const key=secret.SUPABASE_SECRET_KEY;let server=false;
 if(key.startsWith('sb_secret_'))server=key.length>20;else{try{server=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role==='service_role';}catch{server=false;}}
 assert.ok(server,'Production server credential has an unsupported role or format');return true;
}
export function validateCleanProductionScan(scan){assert.equal(scan.imageScanStatus?.status,'COMPLETE');const findings=scan.imageScanFindings?.findingSeverityCounts;assert.ok(findings&&Object.values(findings).every(x=>typeof x==='number'&&x===0),'Production image scan must have zero findings at every severity');return true;}
