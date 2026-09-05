import assert from 'node:assert/strict';
export async function stagingQueueHealth(secret,fetchImpl=fetch,now=Date.now()){
 assert.equal(secret.CONFIGURATION_ENVIRONMENT,'staging');assert.equal(secret.NEXT_PUBLIC_SUPABASE_URL,'https://wztqqqashilusoppddxi.supabase.co');assert.ok(typeof secret.SUPABASE_SECRET_KEY==='string'&&secret.SUPABASE_SECRET_KEY.length>20);
 async function count(parameters){const url=new URL('/rest/v1/notification_email_queue',secret.NEXT_PUBLIC_SUPABASE_URL);url.search=new URLSearchParams({select:'id',...parameters}).toString();const response=await fetchImpl(url,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:secret.SUPABASE_SECRET_KEY,Authorization:'Bearer '+secret.SUPABASE_SECRET_KEY,Prefer:'count=exact'}});assert.ok([200,206].includes(response.status));const total=response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1];assert.ok(total!==undefined);return Number(total);}
 return {failed:await count({status:'eq.Failed'}),staleProcessing:await count({status:'eq.Processing',updated_at:'lt.'+new Date(now-15*60000).toISOString()}),readOnly:true};
}
