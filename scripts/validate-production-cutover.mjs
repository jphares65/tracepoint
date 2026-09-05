import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function validateCutover(input) {
  const fail = message => {throw new Error(message)};
  if(!/^\d{12}$/.test(input.account)||['265544358665','559054714699','111111111111'].includes(input.account)) fail('A reviewed dedicated production account is required');
  if(input.region!=='us-east-1')fail('Region must equal us-east-1');
  if(input.roleArn!==`arn:aws:iam::${input.account}:role/TracePointMigrationProduction`)fail('Exact production role is required');
  if(!/^sha256:[0-9a-f]{64}$/.test(input.imageDigest))fail('Immutable image digest required');
  if(!/^sha256:[0-9a-f]{64}$/.test(input.rollbackImageDigest))fail('Known-good rollback image digest required');
  if(input.hostname!=='tracepointhq.com')fail('Canonical production hostname must be reviewed');
  if(!input.certificateArn?.startsWith(`arn:aws:acm:us-east-1:${input.account}:certificate/`))fail('Production account certificate required');
  if(input.dataMode!=='retain-production-providers')fail('Data transfer requires a separate authorized, rehearsed procedure');
  const required=['accountIdentityVerified','certificateIssued','secretValidated','imageScanPassed','authenticatedAcceptancePassed','alarmsDelivered','backupRestoreRehearsed','rollbackRehearsed','costApproved','dnsRecordsCaptured','agencyApproval'];
  for(const gate of required)if(input.gates?.[gate]!==true)fail(`Unmet cutover gate: ${gate}`);
  return {readyForReview:true,executionAuthorized:false,account:input.account,region:input.region,hostname:input.hostname,dataMode:input.dataMode};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.argv[2])throw new Error('Provide a reviewed evidence JSON file; no deployment or DNS change is executed');
 console.log(JSON.stringify(validateCutover(JSON.parse(await readFile(process.argv[2],'utf8'))),null,2));
}
