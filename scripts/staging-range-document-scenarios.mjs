import assert from 'node:assert/strict';
export async function exerciseRangeDocuments({context,browser,baseURL,department,check}){
 const managerId=process.env.TRACEPOINT_ACCEPTANCE_MANAGER_ID;
 const days=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];const drills=days.map(()=>crypto.randomUUID());const template=crypto.randomUUID();
 const workspace={rangeDays:days.map((id,index)=>({id,departmentId:department,title:'Disposable acceptance range '+index,date:new Date().toISOString().slice(0,10),location:'Disposable staging range',status:index===1?'Locked':'Planned',packetStatus:'Needs Setup',rangeType:'Training',leadInstructorId:managerId,instructorIds:[managerId],outline:[],startTime:'09:00',endTime:'10:00',staffingNotes:''})),drillLibrary:[{id:template,departmentId:department,name:'Disposable acceptance drill',category:'Other',defaultScoringMode:'Scored',defaultRunCount:1,defaultRequired:true,status:'Active',createdByUserId:managerId,createdAt:new Date().toISOString()}],rangeDayDrills:drills.map((id,index)=>({id,rangeDayId:days[index],name:'Disposable acceptance drill',category:'Other',scoringMode:'Scored',runCount:1,required:true,sourceTemplateId:template})),rangeRoster:[],results:[{id:crypto.randomUUID(),rangeDayId:days[2],drillId:drills[2],officerId:managerId,instructorId:managerId,runNumber:1,completed:true,score:100,passed:true}],malfunctions:[]};
 await check('range creation and drill history protections',async()=>{
  const saved=await context.request.put('/api/pilot/range-workspace',{data:{workspace}});assert.equal(saved.status(),200);
  assert.equal((await context.request.get('/api/pilot/range-workspace')).status(),200);
  for(const index of [1,2]){const denied=await context.request.delete('/api/pilot/range-workspace/drills',{data:{rangeDayId:days[index],drillId:drills[index]}});assert.equal(denied.status(),409);}
  const bulk=await context.request.put('/api/pilot/range-workspace',{data:{workspace:{...workspace,rangeDayDrills:[]}}});assert.equal(bulk.status(),409);
  const erased=await context.request.put('/api/pilot/range-workspace',{data:{workspace:{...workspace,results:[]}}});assert.equal(erased.status(),409);
  const removed=await context.request.delete('/api/pilot/range-workspace/drills',{data:{rangeDayId:days[0],drillId:drills[0]}});assert.equal(removed.status(),200);
  const repeat=await context.request.delete('/api/pilot/range-workspace/drills',{data:{rangeDayId:days[0],drillId:drills[0]}});assert.equal(repeat.status(),404);
  const current=await context.request.get('/api/pilot/range-workspace');assert.equal(current.status(),200);const stored=(await current.json()).workspace;assert.equal(stored.rangeDayDrills.length,2);assert.equal(stored.results.length,1);
 });
 await check('Drill Library document upload, view, download, tenant denial and delete',async()=>{
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  const endpoint='/api/drill-library/'+template+'/documents';
  const uploaded=await context.request.post(endpoint,{multipart:{file:{name:'acceptance.png',mimeType:'image/png',buffer:bytes}}});assert.equal(uploaded.status(),201);const id=(await uploaded.json()).document.id;
  const listed=await context.request.get(endpoint);assert.equal(listed.status(),200);assert.equal((await listed.json()).documents.some(x=>x.id===id),true);
  for(const mode of ['view','download']){const signed=await context.request.get('/api/drill-documents/'+id+'/'+mode,{maxRedirects:0});assert.equal(signed.status(),307);const location=new URL(signed.headers().location);assert.equal(location.hostname,'tracepoint-staging-private-559054714699.s3.us-east-1.amazonaws.com');const data=await fetch(location,{redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(data.status,200);assert.deepEqual(Buffer.from(await data.arrayBuffer()),bytes);}
  for(const [email,foreign] of [[process.env.TRACEPOINT_ACCEPTANCE_OFFICER_EMAIL,false],[process.env.TRACEPOINT_ACCEPTANCE_FOREIGN_EMAIL,true]]){
   const other=await browser.newContext({baseURL});try{const page=await other.newPage();await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(process.env.TRACEPOINT_ACCEPTANCE_OFFICER_PASSWORD);await page.locator('button[type="submit"]').click();await page.waitForURL(u=>u.pathname!=='/login');
    if(foreign)assert.equal((await other.request.get('/api/drill-documents/'+id+'/download',{maxRedirects:0})).status(),404);
    else{assert.equal((await other.request.put('/api/pilot/range-workspace',{data:{workspace:{}}})).status(),403);assert.equal((await other.request.post(endpoint,{multipart:{file:{name:'acceptance.png',mimeType:'image/png',buffer:bytes}}})).status(),403);assert.equal((await other.request.delete('/api/drill-documents/'+id)).status(),403);}
   }finally{await other.close();}
  }
  const removed=await context.request.delete('/api/drill-documents/'+id);assert.equal(removed.status(),200);assert.equal((await context.request.get('/api/drill-documents/'+id+'/download',{maxRedirects:0})).status(),404);
 });
}
