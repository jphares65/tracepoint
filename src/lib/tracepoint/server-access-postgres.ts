import "server-only";
import type { PoolClient } from "pg";
import { getPostgresPool } from "@/lib/database/postgres-pool";
import { PostgresDataClient } from "@/lib/database/postgres-data-client";
import type { AuthenticatedPrincipal } from "@/lib/authentication/request-session-core";
import { effectiveDepartmentPermissions } from "./permission-authority";
import type { TracePointPermission } from "./permissions";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const labels:Record<string,string>={administrator:"Administrator",department_admin:"Department Administrator",admin:"Administrator",chief:"Chief",command_staff:"Command Staff",supervisor:"Supervisor",range_master:"Range Master",armorer:"Armorer",instructor:"Instructor",officer:"Officer"};
const priority=["administrator","department_admin","admin","chief","command_staff","supervisor","range_master","armorer","instructor","officer"];
const clean=(value:unknown)=>typeof value==="string"?value.trim():"";
const unique=(values:unknown[])=>[...new Set(values.map(clean).filter(Boolean))];

async function beginSubject(client:PoolClient,subjectId:string){
 await client.query("begin");
 await client.query("set local role authenticated");
 await client.query("select set_config('tracepoint.subject_id',$1,true)",[subjectId]);
}

export async function listPostgresMemberships(principal:AuthenticatedPrincipal){
 const client=await getPostgresPool().connect();
 try{
  await beginSubject(client,principal.userId);
  const result=await client.query(`select m.department_id,m.badge_number,m.rank_title,m.unit_name,
    jsonb_build_object('name',d.name,'short_name',d.short_name,'patch_url',d.patch_url) as departments
    from public.department_memberships m join public.departments d on d.id=m.department_id
    where m.user_id=$1 and m.is_active=true order by d.name,m.department_id`,[principal.userId]);
  await client.query("commit");return result.rows;
 }catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();}
}

export async function resolvePostgresAccess(principal:AuthenticatedPrincipal,selectedDepartmentId:string,supportDepartmentId:string){
 const client=await getPostgresPool().connect();
 try{
  await beginSubject(client,principal.userId);
  const platform=(await client.query("select public.is_platform_admin() as allowed")).rows[0]?.allowed===true;
  const support=Boolean(supportDepartmentId)&&supportDepartmentId===selectedDepartmentId;
  if(support){
   if(!platform){await client.query("rollback");return {ok:false as const,status:403,error:"Platform administrator access is required for Support Mode."};}
   const result=await client.query("select * from public.platform_support_context($1)",[supportDepartmentId]);
   const department=result.rows[0];
   if(!department){await client.query("rollback");return {ok:false as const,status:404,error:"Support Mode agency was not found."};}
   await client.query("commit");
   const email=principal.email,fullName=principal.fullName||email.split("@")[0]||"TracePoint Platform Administrator";
   const dataClient=new PostgresDataClient(getPostgresPool(),principal.userId,supportDepartmentId,null,true);
   return {ok:true as const,context:{
    user:{id:principal.userId,email,user_metadata:{full_name:fullName}},admin:dataClient,db:dataClient,authDb:dataClient,
    userId:principal.userId,email,fullName,departmentId:supportDepartmentId,departmentName:clean(department.name)||"TracePoint Department",
    departmentShortName:clean(department.short_name)||clean(department.name)||"TracePoint",departmentPatchUrl:clean(department.patch_url),
    accentColor:clean(department.accent_color),loginTheme:clean(department.login_theme),badgeNumber:"",rankTitle:"TracePoint Platform Administrator",unitName:"",
    roleCodes:["platform_support"],roleLabels:["Platform Support"],primaryRoleLabel:"Platform Support",
    permissions:["administer_department" as TracePointPermission],isSuperAdmin:true,isSupportMode:true,enabledFeatures:unique(department.enabled_features??[]),
   }};
  }
  const memberships=await client.query("select department_id,badge_number,rank_title,unit_name from public.department_memberships where user_id=$1 and is_active=true order by department_id",[principal.userId]);
  if(!memberships.rowCount){await client.query("rollback");return {ok:false as const,status:403,error:"No active department membership was found."};}
  let membership=selectedDepartmentId?memberships.rows.find(row=>row.department_id===selectedDepartmentId):undefined;
  if(!membership&&memberships.rowCount===1)membership=memberships.rows[0];
  if(!membership){await client.query("rollback");return {ok:false as const,status:409,error:"Multiple active department memberships were found. Select an active agency before access can continue."};}
  const departmentId=String(membership.department_id);
  if(!uuid.test(departmentId))throw new Error("Invalid department identity.");
  await client.query("select set_config('tracepoint.department_id',$1,true)",[departmentId]);
  const department=(await client.query("select name,short_name,patch_url,accent_color,login_theme from public.departments where id=$1",[departmentId])).rows[0];
  const profile=(await client.query("select full_name,email from public.profiles where id=$1",[principal.userId])).rows[0];
  const roles=await client.query("select mr.role_code,r.display_name from public.department_membership_roles mr left join public.roles r on r.code=mr.role_code where mr.department_id=$1 and mr.user_id=$2",[departmentId,principal.userId]);
  const roleCodes=unique(roles.rows.map(row=>row.role_code));
  const permissionRows=roleCodes.length?await client.query("select permission_code from public.department_role_permissions where department_id=$1 and role_code=any($2::text[])",[departmentId,roleCodes]):{rows:[]};
  const features=await client.query("select feature_code from public.department_features where department_id=$1 and is_enabled is not false",[departmentId]);
  await client.query("commit");
  const labelMap=new Map(roles.rows.map(row=>[clean(row.role_code),clean(row.display_name)]));
  const primary=priority.find(code=>roleCodes.includes(code))??roleCodes[0];
  const email=clean(profile?.email)||principal.email;
  const dataClient=new PostgresDataClient(getPostgresPool(),principal.userId,departmentId);
  return {ok:true as const,context:{
   user:{id:principal.userId,email,user_metadata:{full_name:clean(profile?.full_name)}},admin:dataClient,db:dataClient,authDb:dataClient,
   userId:principal.userId,email,fullName:clean(profile?.full_name)||principal.fullName||email.split("@")[0]||"TracePoint User",
   departmentId,departmentName:clean(department?.name)||"TracePoint Department",departmentShortName:clean(department?.short_name)||clean(department?.name)||"TracePoint",
   departmentPatchUrl:clean(department?.patch_url),accentColor:clean(department?.accent_color),loginTheme:clean(department?.login_theme),
   badgeNumber:clean(membership.badge_number),rankTitle:clean(membership.rank_title),unitName:clean(membership.unit_name),
   roleCodes,roleLabels:roleCodes.map(code=>labelMap.get(code)||labels[code]||code),primaryRoleLabel:primary?(labelMap.get(primary)||labels[primary]||primary):"Member",
   permissions:effectiveDepartmentPermissions(roleCodes,permissionRows.rows.map(row=>row.permission_code)) as TracePointPermission[],isSuperAdmin:platform,isSupportMode:false,
   enabledFeatures:unique(features.rows.map(row=>row.feature_code)),
  }};
 }catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();}
}
