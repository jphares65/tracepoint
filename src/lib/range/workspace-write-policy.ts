import {removeRangeDayDrill} from './drill-removal';
type Row=Record<string,unknown>;
const rows=(value:unknown):Row[]=>Array.isArray(value)?value.filter((x):x is Row=>Boolean(x)&&typeof x==='object'):[];
const object=(value:unknown):Row=>value&&typeof value==='object'?value as Row:{};
const canonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Row)[k])).join(',')+'}':JSON.stringify(value);
const collection=(value:Row,camel:string,snake:string)=>rows(value[camel]??value[snake]);
const text=(value:unknown)=>typeof value==='string'?value:'';
export function validateWorkspaceWrite(input:{canManage:boolean;canScore:boolean;previous:unknown;next:unknown;departmentId:string}):{ok:true}|{ok:false;status:403|409;error:string}{
 if(!input.canManage&&!input.canScore)return {ok:false,status:403,error:'Range administration or scoring permission is required.'};
 const previous=object(input.previous),next=object(input.next);
 if(!input.canManage){
  for(const [camel,snake] of [['rangeDays','range_days'],['drillLibrary','drill_library'],['rangeDayDrills','range_day_drills'],['rangeRoster','range_roster']]){
   if(canonical(collection(previous,camel,snake))!==canonical(collection(next,camel,snake)))return {ok:false,status:403,error:'Scoring permission cannot change range setup or roster.'};
  }
 }
 // A bulk save must not bypass the dedicated drill-removal history protections.
 const nextDrills=collection(next,'rangeDayDrills','range_day_drills');
 for(const drill of collection(previous,'rangeDayDrills','range_day_drills')){
  const id=text(drill.id),dayId=text(drill.rangeDayId??drill.range_day_id);
  if(!nextDrills.some(x=>text(x.id)===id&&text(x.rangeDayId??x.range_day_id)===dayId)){
   const result=removeRangeDayDrill(previous,{rangeDayId:dayId,drillId:id,departmentId:input.departmentId});
   if(!result.ok)return {ok:false,status:409,error:result.error};
  }
 }
 for(const [camel,snake] of [['results','drill_run_results'],['malfunctions','firearm_malfunctions']]){
  const nextIds=new Set(collection(next,camel,snake).map(x=>text(x.id)));
  if(collection(previous,camel,snake).some(x=>!nextIds.has(text(x.id))))return {ok:false,status:409,error:'Saved scoring and malfunction history cannot be removed through a bulk workspace save.'};
 }
 return {ok:true};
}
