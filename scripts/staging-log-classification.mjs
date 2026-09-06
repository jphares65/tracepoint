import {createHash} from 'node:crypto';
export function classifyStagingLogs(events,now=Date.now()){
 const report={total:events.length,recent60Minutes:0,categories:{},unknownFingerprints:[],unknownFeatures:[],firstAt:null,lastAt:null};
 for(const event of events){
  const text=String(event.message??''),timestamp=Number(event.timestamp);
  const category=/EACCES|EROFS|permission denied.*(?:mkdir|open|write)/i.test(text)?'filesystem':
   /Failed to find Server Action|Missing .*action.*header|Invalid Server Actions request/i.test(text)?'server-action-request-rejected':
   /AccessDenied|not authorized to perform|UnauthorizedOperation/.test(text)?'aws-authorization':
   /configuration.*(?:invalid|missing|mismatch)|(?:invalid|missing).*configuration|secret.*(?:missing|invalid)/i.test(text)?'configuration':
   /database|postgres|PGRST|SQLSTATE|connection.*(?:refused|terminated)|ECONNREFUSED/i.test(text)?'database-or-connection':
   /JWT|Unauthorized|invalid.*(?:token|session)|session.*expired/i.test(text)?'authentication':
   /ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(text)?'network':
   /out of memory|heap limit|OOM/i.test(text)?'memory':
   /NEXT_REDIRECT|NEXT_NOT_FOUND/.test(text)?'next-control-flow':'unclassified';
  report.categories[category]=(report.categories[category]??0)+1;
  if(Number.isFinite(timestamp)){
   if(timestamp>=now-3600000)report.recent60Minutes++;
   const iso=new Date(timestamp).toISOString();if(!report.firstAt||iso<report.firstAt)report.firstAt=iso;if(!report.lastAt||iso>report.lastAt)report.lastAt=iso;
  }
  if(category==='unclassified'){
   const fingerprint=createHash('sha256').update(text).digest('hex');report.unknownFingerprints.push(fingerprint);
   const vocabulary=['TypeError','ReferenceError','SyntaxError','RangeError','URIError','AggregateError','JSON','parse','undefined','null','workers','payload','headers','decrypt','encryption','Unexpected','Invalid','Server Action','request','body','digest','ENOENT','ENOTFOUND','ECONNRESET','timeout','connection','closed','aborted','pipe','response','socket','premature','command','spawn','exit','EPIPE','MODULE_NOT_FOUND','exception','multipart','stream','failed'];
   report.unknownFeatures.push({fingerprint,features:vocabulary.filter(word=>text.toLowerCase().includes(word.toLowerCase()))});
  }
 }
 report.unknownFingerprints=[...new Set(report.unknownFingerprints)];return report;
}
