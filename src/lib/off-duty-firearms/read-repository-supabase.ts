import type { OffDutyReadDataSource, ReadResult } from "./read-repository-core.ts";
export type Query=PromiseLike<ReadResult>&{select(v:string):Query;eq(k:string,v:unknown):Query;in(k:string,v:string[]):Query;order(k:string,v:{ascending:boolean}):Query;maybeSingle():Query};
export type Client={from(table:string):Query};
export class SupabaseOffDutyReadDataSource implements OffDutyReadDataSource {
 private client:Client;
 constructor(client:Client){this.client=client;}
 listRequests(d:string,u?:string){let q=this.client.from("off_duty_firearm_requests").select("*").eq("department_id",d).order("submitted_at",{ascending:false});if(u)q=q.eq("officer_user_id",u);return q;}
 listHistory(d:string,ids:string[]){return this.client.from("off_duty_firearm_history").select("*").eq("department_id",d).in("request_id",ids).order("created_at",{ascending:true});}
 listInspections(d:string,ids:string[]){return this.client.from("off_duty_firearm_inspections").select("request_id,inspection_date,result,created_at").eq("department_id",d).in("request_id",ids).order("inspection_date",{ascending:false}).order("created_at",{ascending:false});}
 getRules(d:string){return this.client.from("department_rules").select("inspection_interval_days,inspection_due_soon_days").eq("department_id",d).maybeSingle();}
 listProfiles(ids:string[]){return this.client.from("profiles").select("id,full_name").in("id",ids);}
 listMemberships(d:string,ids:string[]){return this.client.from("department_memberships").select("user_id,badge_number,unit_name").eq("department_id",d).eq("is_active",true).in("user_id",ids);}
 getRequest(d:string,id:string){return this.client.from("off_duty_firearm_requests").select("id,department_id,officer_user_id,make,model,serial_number").eq("id",id).eq("department_id",d).maybeSingle();}
 listRequestInspections(d:string,id:string){return this.client.from("off_duty_firearm_inspections").select("id,inspection_date,result,notes,inspected_by_user_id,created_at").eq("department_id",d).eq("request_id",id).order("inspection_date",{ascending:false}).order("created_at",{ascending:false});}
}
