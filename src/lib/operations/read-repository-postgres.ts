import { withPostgresAuthorization, type PostgresAuthorizationPool } from "../database/postgres-authorization-core.ts";
import type { OperationsReadDataSource, OperationsResult } from "./read-repository-core.ts";

type PgError={code?:unknown};
const safeFailure=(error:unknown):OperationsResult=>({data:null,error:{message:"Operations data could not be loaded.",...(typeof (error as PgError)?.code==="string"?{code:(error as PgError).code as string}:{})}});
const iso=(value:unknown)=>value instanceof Date?value.toISOString():value;

export class PostgresOperationsReadDataSource implements OperationsReadDataSource {
 constructor(private readonly pool:PostgresAuthorizationPool,private readonly subjectId:string){}
 async listTrainingEvents(departmentId:string):Promise<OperationsResult>{
  try{return await withPostgresAuthorization(this.pool,{subjectId:this.subjectId,departmentId},async client=>{
   const result=await client.query(`select e.id,e.title,e.training_type,e.starts_at,e.ends_at,e.status,e.location,
     coalesce(a.items,'[]'::jsonb) as agency_training_attendees
     from public.agency_training_events e
     left join lateral (
       select jsonb_agg(jsonb_build_object('id',x.id,'outcome_status',x.outcome_status) order by x.id) as items
       from public.agency_training_attendees x
       where x.department_id=e.department_id and x.event_id=e.id
     ) a on true
     where e.department_id=$1 order by e.starts_at asc`,[departmentId]) as {rows:Array<Record<string,unknown>>};
   return {data:result.rows.map(row=>({...row,starts_at:iso(row.starts_at),ends_at:iso(row.ends_at)})),error:null};
  });}catch(error){return safeFailure(error);}
 }
 async listFleetVehicles(departmentId:string):Promise<OperationsResult>{
  try{return await withPostgresAuthorization(this.pool,{subjectId:this.subjectId,departmentId},async client=>{
   const result=await client.query(`select id,unit_number,year,make,model,status,open_issue_count,next_service_date,inspection_due_date,registration_expiration_date
     from public.fleet_vehicles where department_id=$1 and status<>$2`,[departmentId,"Retired"]) as {rows:Array<Record<string,unknown>>};
   return {data:result.rows,error:null};
  });}catch(error){return safeFailure(error);}
 }
}
