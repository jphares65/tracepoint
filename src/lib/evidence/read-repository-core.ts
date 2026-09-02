import { workspaceHasDrillTemplate } from "../tracepoint/drill-documents-core.ts";
export type EvidenceResult={data:any;error:{message:string}|null};
export interface EvidenceReadDataSource { getFirearm(d:string,id:string):PromiseLike<EvidenceResult>; listFirearmAttachments(d:string,id:string):PromiseLike<EvidenceResult>; getRangeWorkspace(d:string):PromiseLike<EvidenceResult>; listQualificationEvidence(d:string,id:string):PromiseLike<EvidenceResult>; listDrillDocuments(d:string,id:string):PromiseLike<EvidenceResult>; getAttachment(d:string,id:string):PromiseLike<EvidenceResult>; }
export class EvidenceReadAuthorizationError extends Error{} export class EvidenceReadRepositoryError extends Error{}
export function requireEvidenceReadProvider(value?:string){const p=value?.trim().toLowerCase()||"supabase";if(p!=="supabase")throw new Error(`Unsupported data provider: ${p}. Only supabase is implemented.`);return p;}
export class TenantBoundEvidenceReadRepository{
 private source:EvidenceReadDataSource; private departmentId:string;
 constructor(source:EvidenceReadDataSource,departmentId:string){this.source=source;this.departmentId=departmentId;if(!departmentId)throw new EvidenceReadAuthorizationError();}
 private check(d:string){if(d!==this.departmentId)throw new EvidenceReadAuthorizationError();} private async value(result:PromiseLike<EvidenceResult>){const r=await result;if(r.error)throw new EvidenceReadRepositoryError(r.error.message);return r.data??null;} private async rows(result:PromiseLike<EvidenceResult>){const d=await this.value(result);return Array.isArray(d)?d:[];}
 getFirearm(d:string,id:string){this.check(d);return this.value(this.source.getFirearm(d,id));} listFirearmAttachments(d:string,id:string){this.check(d);return this.rows(this.source.listFirearmAttachments(d,id));}
 async qualificationExists(d:string,id:string){this.check(d);const row=await this.value(this.source.getRangeWorkspace(d));const results=Array.isArray(row?.workspace?.results)?row.workspace.results:[];return results.some((r:any)=>String(r?.id??"")===id);}
 listQualificationEvidence(d:string,id:string){this.check(d);return this.rows(this.source.listQualificationEvidence(d,id));}
 async drillTemplateExists(d:string,id:string){this.check(d);if(!/^[a-zA-Z0-9._:-]{1,255}$/.test(id))return false;const row=await this.value(this.source.getRangeWorkspace(d));return workspaceHasDrillTemplate(row?.workspace,id);}
 listDrillDocuments(d:string,id:string){this.check(d);return this.rows(this.source.listDrillDocuments(d,id));} getAttachment(d:string,id:string){this.check(d);return this.value(this.source.getAttachment(d,id));}
}
