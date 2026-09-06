// Extract only the known sanitized reports from completed workflow logs. Never
// persist raw logs, provider secrets, queue contents or arbitrary extra fields.
export function operationsEvidence(logs){
 const lines=logs.split(/\r?\n/),reports=[];
 for(let i=0;i<lines.length;i++){
  if(lines[i].trim()!=='{')continue;
  for(let j=i+1;j<Math.min(i+300,lines.length);j++){
   if(lines[j].trim()!=='}')continue;
   let value;try{value=JSON.parse(lines.slice(i,j+1).join('\n'));}catch{continue;}
   i=j;if(value.account!=='559054714699'||value.region!=='us-east-1')break;
   const safe={account:value.account,region:value.region};
   if(value.ecs&&/^[0-9a-f]{40}$/.test(value.imageTag??'')){
    safe.kind='runtime';safe.imageTag=value.imageTag;
    for(const key of ['checkedAt','stackStatus','expectedDigest','runningDigest'])if(typeof value[key]==='string'&&/^[A-Za-z0-9:_.+-]{1,100}$/.test(value[key]))safe[key]=value[key];
    for(const key of ['identityVerified','imageMatches','passed'])if(typeof value[key]==='boolean')safe[key]=value[key];
    safe.ecs={};for(const key of ['desired','running','pending','revision'])if(Number.isInteger(value.ecs[key]))safe.ecs[key]=value.ecs[key];safe.ecs.completed=value.ecs.completed===true;
    safe.targets=(value.targets??[]).filter(x=>['healthy','unhealthy','initial','draining','unused','unavailable'].includes(x));
    safe.alarms=(value.alarms??[]).filter(x=>/^tracepoint-staging[-A-Za-z0-9]+$/.test(x.name)&&['OK','ALARM','INSUFFICIENT_DATA'].includes(x.state)).map(x=>({name:x.name,state:x.state}));
    safe.public=(value.public??[]).filter(x=>/^\/[A-Za-z0-9/-]*$/.test(x.route)&&Number.isInteger(x.status)).map(x=>({route:x.route,status:x.status,passed:x.passed===true}));
    safe.logs={};for(const key of ['matchingErrors','filesystemPermissionErrors'])if(Number.isInteger(value.logs?.[key]))safe.logs[key]=value.logs[key];safe.logs.currentTaskOnly=value.logs?.currentTaskOnly===true;
    safe.notificationQueue={};for(const key of ['failed','staleProcessing'])if(Number.isInteger(value.notificationQueue?.[key]))safe.notificationQueue[key]=value.notificationQueue[key];
    safe.scan={status:value.scan?.status==='COMPLETE'?'COMPLETE':'not complete',findings:{}};
    for(const key of ['CRITICAL','HIGH','MEDIUM','LOW','INFORMATIONAL','UNDEFINED'])if(Number.isInteger(value.scan?.findings?.[key]))safe.scan.findings[key]=value.scan.findings[key];
    reports.push(safe);
   }else if(value.kind==='log-diagnostics'&&Number.isInteger(value.revision)&&value.classification){
    safe.kind='log-diagnostics';safe.revision=value.revision;safe.messagesPrinted=value.messagesPrinted===true;
    safe.classification={categories:{},unknownFingerprints:[]};
    for(const key of ['total','recent60Minutes'])if(Number.isInteger(value.classification[key]))safe.classification[key]=value.classification[key];
    for(const key of ['firstAt','lastAt'])if(typeof value.classification[key]==='string'&&/^\d{4}-\d\d-\d\dT[0-9:.]+Z$/.test(value.classification[key]))safe.classification[key]=value.classification[key];
    for(const key of ['filesystem','server-action-request-rejected','aws-authorization','configuration','database-or-connection','authentication','network','memory','next-control-flow','unclassified'])if(Number.isInteger(value.classification.categories?.[key]))safe.classification.categories[key]=value.classification.categories[key];
    safe.classification.unknownFingerprints=(value.classification.unknownFingerprints??[]).filter(x=>/^[0-9a-f]{64}$/.test(x));reports.push(safe);
   }else if(typeof value.queriedAtUTC==='string'&&Number.isFinite(value.budgetActualUSD)){
    safe.kind='cost';if(/^\d{4}-\d\d-\d\dT[0-9:.]+Z$/.test(value.queriedAtUTC))safe.queriedAtUTC=value.queriedAtUTC;
    for(const key of ['budgetActualUSD','budgetLimitUSD','modeledMonthlyUSD','disposableRehearsalReserveUSD'])if(Number.isFinite(value[key]))safe[key]=value[key];
    safe.withinCeiling=value.withinCeiling===true;safe.costExplorer={available:value.costExplorer?.available===true};
    if(safe.costExplorer.available&&Number.isFinite(value.costExplorer.unblendedCostUSD)){safe.costExplorer.unblendedCostUSD=value.costExplorer.unblendedCostUSD;safe.costExplorer.estimated=value.costExplorer.estimated===true;}
    reports.push(safe);
   }
   break;
  }
 }
 return reports;
}
