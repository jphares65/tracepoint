import assert from 'node:assert/strict';
import {validateTracePointRuntimeConfig} from './validate-tracepoint-runtime-config.mjs';
export const productionArchivePaths=['.dockerignore','buildspec.production-image.yml','Dockerfile','eslint.config.mjs','next.config.ts','package.json','package-lock.json','postcss.config.mjs','tsconfig.json','public','src','scripts/start-tracepoint-container.mjs','scripts/validate-tracepoint-runtime-config.mjs'];
export const productionRestLedgerArchivePaths=['.dockerignore','buildspec.supabase-rest-ledger.yml','Dockerfile.supabase-rest-ledger','package.json','package-lock.json','scripts/run-supabase-rest-ledger.mjs','scripts/supabase-rest-ledger-core.mjs','scripts/supabase-rest-ledger-core.test.mjs','scripts/immutable-source-artifact-validator.mjs','scripts/immutable-source-artifact-validator.test.mjs'];
export const productionRestInitialImportArchivePaths=['.dockerignore','buildspec.supabase-rest-initial-import.yml','Dockerfile.supabase-rest-initial-import','package.json','package-lock.json','database/aws/022_cognito_flow_window.sql','database/aws/023_audit_log_read_authorization.sql','scripts/supabase-rest-ledger-core.mjs','scripts/supabase-rest-import-core.mjs','scripts/supabase-rest-import-core.test.mjs','scripts/immutable-source-artifact-validator.mjs','scripts/run-supabase-rest-initial-import.mjs'];
export const productionBuildSecretKeys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_SITE_URL','NEXT_SERVER_ACTIONS_ENCRYPTION_KEY'];
export const productionRuntimeSecretKeys=['SUPABASE_SECRET_KEY','BREVO_API_KEY','NOTIFICATION_DISPATCH_SECRET','NEXT_SERVER_ACTIONS_ENCRYPTION_KEY','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_SITE_URL','CONFIGURATION_ENVIRONMENT'];
export function validateProductionArchive(entries,tracked){
 assert.ok(entries.length>0);for(const entry of entries){assert.ok(tracked.has(entry),'Untracked archive path');assert.ok(!/(^|\/)\.env($|\.)|(^|\/)\.aws\/|(^|\/)\.git\/|(^|\/)\.github\/|(^|\/)node_modules\/|(^|\/)\.next\/|(^|\/)cdk\.out|\.tsbuildinfo$|\.(dump|sql)$|(^|\/)[^/]*(credential|secret)[^/]*$|API KEYS|integration-demo|seed-demo-fleet-equipment|\.(backup|encoding-backup)-|\.before-|\.bak($|-)/i.test(entry),'Prohibited archive path');}
 assert.ok(entries.includes('buildspec.production-image.yml'));assert.ok(!entries.includes('buildspec.staging-image.yml'));return entries.length;
}
export function validateProductionRestLedgerArchive(entries,tracked){
 assert.ok(entries.length>0);for(const entry of entries){
  assert.ok(tracked.has(entry),'Untracked REST-ledger archive path');
  assert.ok(!/(^|\/)\.env($|\.)|(^|\/)\.aws\/|(^|\/)\.git\/|(^|\/)\.github\/|(^|\/)node_modules\/|(^|\/)\.next\/|(^|\/)(coverage|build|out)\/|\.tsbuildinfo$|\.(dump|sql)$|(^|\/)[^/]*(credential|secret)[^/]*$|API KEYS|integration-demo|seed-demo-fleet-equipment|\.(backup|encoding-backup)-|\.before-|\.bak($|-)/i.test(entry),'Prohibited REST-ledger archive path');
 }
 assert.deepEqual([...entries].sort(),[...productionRestLedgerArchivePaths].sort(),'REST-ledger archive must contain only source-only extractor files');
 return entries.length;
}
export function validateProductionRestInitialImportArchive(entries,tracked){
 assert.ok(entries.length>0);for(const entry of entries){
  assert.ok(tracked.has(entry),'Untracked REST initial-import archive path');
  assert.ok(!/(^|\/)\.env($|\.)|(^|\/)\.aws\/|(^|\/)\.git\/|(^|\/)node_modules\/|(^|\/)\.next\/|(^|\/)(coverage|build|out)\/|\.tsbuildinfo$|\.dump$|(^|\/)[^/]*(credential|secret)[^/]*$|API KEYS|integration-demo|seed-demo-fleet-equipment|\.(backup|encoding-backup)-|\.before-|\.bak($|-)/i.test(entry),'Prohibited REST initial-import archive path');
  assert.ok(!entry.endsWith('.sql') || ['database/aws/022_cognito_flow_window.sql','database/aws/023_audit_log_read_authorization.sql'].includes(entry),'Only two reviewed AWS migration SQL files may enter the importer archive');
 }
 assert.deepEqual([...entries].sort(),[...productionRestInitialImportArchivePaths].sort(),'REST initial-import archive must contain only isolated migration files');
 return entries.length;
}
export function validateProductionBuildSecret(secret){
 for(const key of productionBuildSecretKeys)assert.ok(typeof secret?.[key]==='string'&&secret[key].trim(),`Missing production build secret field: ${key}`);
 assert.equal(secret.NEXT_PUBLIC_SUPABASE_URL,'https://izlkwggluhlhzlumtzes.supabase.co');
 assert.equal(secret.NEXT_PUBLIC_SITE_URL,'https://tracepointhq.com');
 assert.match(secret.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,/^[A-Za-z0-9+/]+={0,2}$/);
 assert.ok([16,24,32].includes(Buffer.from(secret.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,'base64').length),'Production Server Actions key must decode to 16, 24, or 32 bytes');
 return true;
}
export function validateProductionSecret(secret){
 validateProductionBuildSecret(secret);
 assert.deepEqual(Object.keys(secret).sort(),[...productionRuntimeSecretKeys].sort(),'Production runtime secret must contain exactly eight fields');
 validateTracePointRuntimeConfig({...secret,TRACEPOINT_DATA_PROVIDER:'supabase',TRACEPOINT_EMAIL_PROVIDER:'brevo',TRACEPOINT_STORAGE_PROVIDER:'supabase'});
 assert.equal(secret.CONFIGURATION_ENVIRONMENT,'production');
 assert.ok(secret.NOTIFICATION_DISPATCH_SECRET.length>=32,'Production notification secret must contain at least 32 characters');
 const key=secret.SUPABASE_SECRET_KEY;let server=false;
 if(key.startsWith('sb_secret_'))server=key.length>20;else{try{server=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role==='service_role';}catch{server=false;}}
 assert.ok(server,'Production server credential has an unsupported role or format');return true;
}
export function assembleProductionRuntimeSecret(existing,environment,brevoKey,newNotificationSecret){
 validateProductionBuildSecret(existing);
 assert.equal(environment.NEXT_PUBLIC_SUPABASE_URL,existing.NEXT_PUBLIC_SUPABASE_URL,'Local and built production Supabase URLs differ');
 assert.equal(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,existing.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,'Local and built production Supabase publishable keys differ');
 const notification=typeof existing.NOTIFICATION_DISPATCH_SECRET==='string'&&existing.NOTIFICATION_DISPATCH_SECRET.length>=32?existing.NOTIFICATION_DISPATCH_SECRET:newNotificationSecret;
 const secret={SUPABASE_SECRET_KEY:environment.SUPABASE_SECRET_KEY,BREVO_API_KEY:brevoKey.trim(),NOTIFICATION_DISPATCH_SECRET:notification,NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:existing.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,NEXT_PUBLIC_SUPABASE_URL:existing.NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:existing.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,NEXT_PUBLIC_SITE_URL:existing.NEXT_PUBLIC_SITE_URL,CONFIGURATION_ENVIRONMENT:'production'};
 validateProductionSecret(secret);return secret;
}
export function validateCleanProductionScan(scan){assert.equal(scan.imageScanStatus?.status,'COMPLETE');const findings=scan.imageScanFindings?.findingSeverityCounts;assert.ok(findings&&Object.values(findings).every(x=>typeof x==='number'&&x===0),'Production image scan must have zero findings at every severity');return true;}
