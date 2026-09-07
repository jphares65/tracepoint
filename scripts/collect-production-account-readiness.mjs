import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {evaluateProductionAccountReadiness} from './production-account-readiness-core.mjs';

function readAws(args) {
  try {
    return JSON.parse(execFileSync('aws.exe', [...args, '--output', 'json'], {encoding:'utf8',stdio:['ignore','pipe','ignore']}));
  } catch {
    return null;
  }
}

export function collectProductionAccountReadiness() {
  const identity = readAws(['sts','get-caller-identity','--region','us-east-1']);
  if (!identity) throw new Error('Staging OIDC identity unavailable');
  const organization = readAws(['organizations','describe-organization']);
  const accountResult = readAws(['organizations','list-accounts']);
  const accounts = accountResult?.Accounts ?? null;
  const policiesByAccount = {};
  if (Array.isArray(accounts)) {
    for (const account of accounts.filter(value => value?.Status === 'ACTIVE' && !['265544358665','559054714699'].includes(value.Id) && /tracepoint.*prod|prod.*tracepoint/i.test(value.Name ?? ''))) {
      const result = readAws(['organizations','list-policies-for-target','--target-id',account.Id,'--filter','SERVICE_CONTROL_POLICY']);
      policiesByAccount[account.Id] = result?.Policies ?? null;
    }
  }
  return evaluateProductionAccountReadiness({identity,organization,accounts,policiesByAccount});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify({productionAccountReadiness:collectProductionAccountReadiness()}, null, 2));
  } catch {
    console.error('Production account discovery unavailable; credentials and account metadata suppressed.');
    process.exitCode = 1;
  }
}

