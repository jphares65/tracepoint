import assert from 'node:assert/strict';
async function expectStatus(response,status,step){if(response.status()!==status){const body=await response.json().catch(()=>({}));const message=String(body.error??'');const known=['permission denied','violates check constraint','violates not-null constraint','violates foreign key constraint','Could not find the function','does not exist','invalid input syntax'].find(x=>message.includes(x))??'unclassified';const object=message.match(/(?:constraint|column) "([a-z0-9_]+)"/);console.log(JSON.stringify({acceptanceStep:step,status:response.status(),failureClass:known,structuralDiagnostic:/^(Could not|cannot|permission|new row|invalid|column|record|function|null value|relation|duplicate|insert or update|operator|structure)/i.test(message)?message.replace(/"[^"]*"|'[^']*'/g,'[quoted]').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi,'[id]').replace(/https?:\/\/\S+|\S+@\S+|[A-Za-z0-9_-]{32,}/g,'[value]').slice(0,160):undefined,schemaObject:object?.[1]}));}assert.equal(response.status(),status);}

// Only receives generated fixture identities; all writes use real application sessions.
export async function exerciseExtendedWorkflows({context,browser,baseURL,check}) {
 const officer=await browser.newContext({baseURL});const foreign=await browser.newContext({baseURL});
 try {
  for(const [session,email] of [[officer,process.env.TRACEPOINT_ACCEPTANCE_OFFICER_EMAIL],[foreign,process.env.TRACEPOINT_ACCEPTANCE_FOREIGN_EMAIL]]) {
   const page=await session.newPage();await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(process.env.TRACEPOINT_ACCEPTANCE_OFFICER_PASSWORD);await page.locator('button[type="submit"]').click();await page.waitForURL(u=>u.pathname!=='/login');
  }
  const run=crypto.randomUUID();const today=new Date().toISOString().slice(0,10);
  await check('off-duty submission, inspection, command approval and Inbox delivery',async()=>{
   const created=await officer.request.post('/api/off-duty-firearms',{data:{make:'Synthetic',model:'Acceptance',firearmType:'Handgun',serial:'test-'+run,caliber:'9mm',policyAcknowledged:true,proofOwnership:true}});assert.equal(created.status(),201);
   const id=(await created.json()).requestId;assert.ok(id);const endpoint='/api/off-duty-firearms/'+id;
   const approval={action:'Approve',effectiveDate:today,expirationDate:new Date(Date.now()+30*86400000).toISOString().slice(0,10)};
   assert.equal((await officer.request.patch(endpoint,{data:approval})).status(),403);
   assert.equal((await foreign.request.patch(endpoint,{data:approval})).status(),403);
   assert.equal((await context.request.patch(endpoint,{data:approval})).status(),409);
   await expectStatus(await context.request.post(endpoint+'/inspections',{data:{inspectionDate:today,result:'Pass',notes:'Disposable staging inspection'}}),200,'off-duty inspection');
   await expectStatus(await context.request.patch(endpoint,{data:{...approval,qualificationOverride:true,qualificationOverrideReason:'Disposable staging acceptance of explicit command exception'}}),200,'off-duty approval');
   const inbox=await officer.request.get('/api/notifications');assert.equal(inbox.status(),200);const payload=await inbox.json();assert.ok(payload.items.some(x=>x.title==='Off-Duty Firearm Approved'));
  });
  await check('fleet creation, inspection, report and permission isolation',async()=>{
   const data={unitNumber:'test-'+run,make:'Synthetic',model:'Acceptance',currentMileage:100,assignmentType:'Pool'};
   assert.equal((await officer.request.post('/api/fleet/vehicles',{data})).status(),403);
   const created=await context.request.post('/api/fleet/vehicles',{data});assert.equal(created.status(),201);const id=(await created.json()).item.id;
   assert.equal((await foreign.request.get('/api/fleet/vehicles/'+id)).status(),404);
   const inspected=await context.request.post('/api/fleet/vehicles/'+id+'/inspections',{data:{mileage:101,checklist:['body','tires','lights','controls','fluids','interior'].map(id=>({id,condition:'Pass'}))}});assert.equal(inspected.status(),201);
   const report=await context.request.get('/api/fleet/report');assert.equal(report.status(),200);const payload=await report.json();assert.ok(payload.vehicles.some(x=>x.id===id));assert.ok(payload.inspections.length>=1);
   const other=await foreign.request.get('/api/fleet/report');assert.equal(other.status(),403);
  });
  await check('agency training course, event, roster and tenant-isolated CSV export',async()=>{
   const course=await context.request.post('/api/agency-training/courses',{data:{canonicalTitle:'Acceptance '+run,trainingType:'In-Service',defaultHours:1}});assert.equal(course.status(),201);const courseId=(await course.json()).course.id;
   const data={title:'Acceptance '+run,courseId,startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),status:'draft',defaultHours:1};
   assert.equal((await officer.request.post('/api/agency-training/events',{data})).status(),403);
   const event=await context.request.post('/api/agency-training/events',{data});assert.equal(event.status(),201);const id=(await event.json()).event.id;
   const roster='/api/agency-training/events/'+id+'/roster';
   assert.equal((await context.request.put(roster,{data:{attendees:[{userId:process.env.TRACEPOINT_ACCEPTANCE_FOREIGN_USER_ID}]}})).status(),400);
   assert.equal((await context.request.put(roster,{data:{attendees:[{userId:process.env.TRACEPOINT_ACCEPTANCE_OFFICER_ID}]}})).status(),200);
   const report='/api/agency-training/events/'+id+'/report';const csv=await context.request.get(report);assert.equal(csv.status(),200);assert.match(csv.headers()['content-type'],/text\/csv/);assert.match(csv.headers()['content-disposition'],/attachment/);assert.ok((await csv.text()).includes('Disposable acceptance officer'));
   assert.equal((await foreign.request.get(report)).status(),404);
  });
  await check('armory creation, assignment, inspection and return',async()=>{
   const data={make:'Synthetic',model:'Acceptance',serialNumber:'test-'+run,firearmType:'handgun',caliber:'9mm'};
   assert.equal((await officer.request.post('/api/armory/firearms',{data})).status(),403);
   const created=await context.request.post('/api/armory/firearms',{data});assert.equal(created.status(),201);const id=(await created.json()).firearmId;assert.ok(id);
   const assignment='/api/armory/firearms/'+id+'/assignments';
   assert.equal((await context.request.post(assignment,{data:{assignedToUserId:process.env.TRACEPOINT_ACCEPTANCE_FOREIGN_USER_ID}})).status(),400);
   assert.equal((await context.request.post(assignment,{data:{assignedToUserId:process.env.TRACEPOINT_ACCEPTANCE_OFFICER_ID,magazinesIssued:0}})).status(),200);
   const inspection=await context.request.post('/api/armory/inspections',{data:{firearmId:id,inspectionType:'Routine',result:'Pass',inspectionDate:today,checklist:[{label:'Disposable function check',status:'Pass'}]}});assert.equal(inspection.status(),200);
   assert.equal((await context.request.patch(assignment,{data:{magazinesReturned:0}})).status(),200);
  });
  await check('certification creation and foreign-member denial',async()=>{
   const type=await context.request.post('/api/training/certification-types',{data:{name:'Acceptance '+run,category:'General',expirationRequired:true,defaultValidDays:365}});assert.equal(type.status(),201);const id=(await type.json()).certificationType.id;
   const data={certificationTypeId:id,userId:process.env.TRACEPOINT_ACCEPTANCE_OFFICER_ID,issueDate:today,expirationDate:new Date(Date.now()+365*86400000).toISOString().slice(0,10)};
   assert.equal((await officer.request.post('/api/training/certifications',{data})).status(),403);
   assert.equal((await context.request.post('/api/training/certifications',{data:{...data,userId:process.env.TRACEPOINT_ACCEPTANCE_FOREIGN_USER_ID}})).status(),400);
   assert.equal((await context.request.post('/api/training/certifications',{data})).status(),201);
  });
  await check('personnel browser CSV download excludes foreign tenant',async()=>{
   const page=await context.newPage();try{await page.goto('/settings/import-export');const pending=page.waitForEvent('download');await page.getByRole('button',{name:/Personnel Export active department personnel records/}).click();const download=await pending;assert.match(download.suggestedFilename(),/^tracepoint-personnel-.*\.csv$/);const stream=await download.createReadStream();let bytes=0;const chunks=[];for await(const chunk of stream){bytes+=chunk.length;assert.ok(bytes<1024*1024);chunks.push(chunk);}const csv=Buffer.concat(chunks).toString('utf8');assert.ok(csv.includes(process.env.TRACEPOINT_ACCEPTANCE_OFFICER_EMAIL));assert.equal(csv.includes(process.env.TRACEPOINT_ACCEPTANCE_FOREIGN_EMAIL),false);}finally{await page.close();}
  });
 } finally {await officer.close();await foreign.close();}
}
