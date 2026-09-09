import assert from 'node:assert/strict';

export function percentile(values, fraction) {
  assert.ok(values.length > 0, 'At least one duration is required');
  assert.ok(fraction > 0 && fraction <= 1, 'Percentile must be in (0, 1]');
  return [...values].sort((left,right)=>left-right)[Math.ceil(values.length*fraction)-1];
}

export async function runBoundedProbe({request,verify=()=>{},concurrency,requestsPerWorker,maxP95Milliseconds}) {
  assert.ok(Number.isInteger(concurrency) && concurrency > 0 && concurrency <= 20, 'Concurrency must be between 1 and 20');
  assert.ok(Number.isInteger(requestsPerWorker) && requestsPerWorker > 0 && requestsPerWorker <= 100, 'Requests per worker must be between 1 and 100');
  const durations=[];
  await Promise.all(Array.from({length:concurrency},async()=>{
    for(let index=0;index<requestsPerWorker;index++){
      const start=performance.now();
      const response=await request();
      await verify(response);
      durations.push(Math.ceil(performance.now()-start));
    }
  }));
  const p95Milliseconds=percentile(durations,.95);
  assert.ok(p95Milliseconds<maxP95Milliseconds,`Bounded staging requests exceeded ${maxP95Milliseconds}ms p95`);
  return {requests:durations.length,concurrency,p95Milliseconds};
}

