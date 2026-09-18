import assert from "node:assert/strict";
import test from "node:test";
import { PostgresOperationsReadDataSource } from "./read-repository-postgres.ts";
import { TenantBoundOperationsReadRepository } from "./read-repository-core.ts";

const subjectId="20000000-0000-4000-8000-000000000001",departmentId="10000000-0000-4000-8000-000000000001";

test("PostgreSQL operations preserves JSON shape tenant parameters and natural fleet order",async()=>{
 const calls:Array<{text:string;values?:readonly unknown[]}>=[];
 const client={async query(text:string,values?:readonly unknown[]){calls.push({text,values});if(text.includes("agency_training_events e"))return{rows:[{id:"event",starts_at:new Date("2026-09-09T12:00:00Z"),ends_at:new Date("2026-09-09T13:00:00Z"),agency_training_attendees:[]}]};if(text.includes("fleet_vehicles"))return{rows:[{unit_number:"Car 10"},{unit_number:"Car 2"}]};return{rows:[]};},release(){}};
 const repository=new TenantBoundOperationsReadRepository(new PostgresOperationsReadDataSource({async connect(){return client;}},subjectId),departmentId);
 const [training,fleet]=await repository.getCommandDashboard(departmentId);
 assert.equal((training.data as Array<{starts_at:string}>)[0].starts_at,"2026-09-09T12:00:00.000Z");
 assert.deepEqual((fleet.data as Array<{unit_number:string}>).map(row=>row.unit_number),["Car 2","Car 10"]);
 assert.ok(calls.some(call=>call.text.includes("agency_training_events")&&call.values?.[0]===departmentId));
 assert.ok(calls.some(call=>call.text.includes("status<>$2")&&call.values?.[1]==="Retired"));
 assert.equal(calls.filter(call=>call.text==="commit").length,2);
});

test("PostgreSQL operations isolates sibling failures and sanitizes database detail",async()=>{
 const client={async query(text:string){if(text.includes("agency_training_events")){const error=Object.assign(new Error("sensitive table detail"),{code:"42P01"});throw error;}return{text,rows:[]};},release(){}};
 const source=new PostgresOperationsReadDataSource({async connect(){return client;}},subjectId);
 const [training,fleet]=await Promise.all([source.listTrainingEvents(departmentId),source.listFleetVehicles(departmentId)]);
 assert.deepEqual(training.error,{message:"Operations data could not be loaded.",code:"42P01"});
 assert.equal(fleet.error,null);
});
