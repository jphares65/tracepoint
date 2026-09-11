import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const account='559054714699',region='us-east-1';
function aws(args){try{return JSON.parse(execFileSync(process.platform==='win32'?'aws.exe':'aws',[...args,'--region',region,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}));}catch{throw Error('Staging cost metadata unavailable.');}}
try {
 const identity=aws(['sts','get-caller-identity']);assert.equal(identity.Account,account);assert.match(identity.Arn,/^arn:aws:sts::559054714699:assumed-role\/[^/]*TracePointMigrationStaging[^/]*\//);
 const budget=aws(['budgets','describe-budget','--account-id',account,'--budget-name','tracepoint-staging-monthly-125']).Budget;
 assert.equal(budget.BudgetLimit.Unit,'USD');assert.equal(Number(budget.BudgetLimit.Amount),125);
 const actual=Number(budget.CalculatedSpend?.ActualSpend?.Amount);assert.ok(Number.isFinite(actual)&&actual>=0);assert.equal(budget.CalculatedSpend.ActualSpend.Unit,'USD');
 const model=JSON.parse(readFileSync(new URL('../docs/aws-staging-cost-model-20260904.json',import.meta.url),'utf8'));
 const modeledMonthlyUSD=Object.values(model.componentsCents).reduce((sum,value)=>sum+value,0)/100;assert.ok(Number.isFinite(modeledMonthlyUSD));
 const now=new Date(),start=now.toISOString().slice(0,7)+'-01',end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1)).toISOString().slice(0,10);
 let costExplorer={available:false,reason:'Current role has no usable Cost Explorer access; budget actual is reported separately.'};
 try {const result=aws(['ce','get-cost-and-usage','--time-period',`Start=${start},End=${end}`,'--granularity','MONTHLY','--metrics','UnblendedCost']);
  assert.ok(result.ResultsByTime?.length);assert.ok(result.ResultsByTime.every(row=>row.Total.UnblendedCost.Unit==='USD'));
  const amount=result.ResultsByTime.reduce((sum,row)=>sum+Number(row.Total.UnblendedCost.Amount),0);assert.ok(Number.isFinite(amount)&&amount>=0);
  costExplorer={available:true,unblendedCostUSD:amount,estimated:result.ResultsByTime.some(row=>row.Estimated)};
 }catch{}
 const withinCeiling=actual<125&&modeledMonthlyUSD+2<125&&(!costExplorer.available||costExplorer.unblendedCostUSD<125);
 console.log(JSON.stringify({account,region,queriedAtUTC:now.toISOString(),period:{start,endExclusive:end},budgetActualUSD:actual,budgetLimitUSD:125,modeledMonthlyUSD,disposableRehearsalReserveUSD:2,costExplorer,withinCeiling,billingLagNote:'Budget actual and estimated billing lag usage. This model is not a measured monthly bill or hard spending cap.'},null,2));
 if(!withinCeiling)process.exitCode=1;
}catch{console.error('Staging cost evidence failed its identity/budget gate; sensitive details suppressed.');process.exitCode=1;}
