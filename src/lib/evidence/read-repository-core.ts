import { workspaceHasDrillTemplate } from "../tracepoint/drill-documents-core.ts";
export type EvidenceResult={data:any;error:{message:string}|null};
export interface EvidenceReadDataSource { getFirearm(d:string,id:string):PromiseLike<EvidenceResult>; listFirearmAttachments(d:string,id:string):PromiseLike<EvidenceResult>; getRangeWorkspace(d:string):PromiseLike<EvidenceResult>; listQualificationEvidence(d:string,id:string):PromiseLike<EvidenceResult>; listDrillDocuments(d:string,id:string):PromiseLike<EvidenceResult>; getAttachment(d:string,id:string):PromiseLike<EvidenceResult>; getStoredQualificationResult?(d:string,id:string):PromiseLike<EvidenceResult>; }
export class EvidenceReadAuthorizationError extends Error{} export class EvidenceReadRepositoryError extends Error{}
export function requireEvidenceReadProvider(value?:string){const p=value?.trim().toLowerCase()||"supabase";if(p!=="supabase"&&p!=="postgres")throw new Error(`Unsupported data provider: ${p}.`);return p;}
export class TenantBoundEvidenceReadRepository{
 private source:EvidenceReadDataSource; private departmentId:string;
 constructor(source:EvidenceReadDataSource,departmentId:string){this.source=source;this.departmentId=departmentId;if(!departmentId)throw new EvidenceReadAuthorizationError();}
 private check(d:string){if(d!==this.departmentId)throw new EvidenceReadAuthorizationError();} private async value(result:PromiseLike<EvidenceResult>){const r=await result;if(r.error)throw new EvidenceReadRepositoryError(r.error.message);return r.data??null;} private async rows(result:PromiseLike<EvidenceResult>){const d=await this.value(result);return Array.isArray(d)?d:[];}
 getFirearm(d:string,id:string){this.check(d);return this.value(this.source.getFirearm(d,id));} listFirearmAttachments(d:string,id:string){this.check(d);return this.rows(this.source.listFirearmAttachments(d,id));}
 async qualificationExists(d:string,id:string){return Boolean(await this.qualificationResult(d,id));}
 async qualificationResult(d:string,id:string):Promise<Record<string,unknown>|null>{this.check(d);const row=await this.value(this.source.getRangeWorkspace(d));const results=Array.isArray(row?.workspace?.results)?row.workspace.results:[];const live=results.find((r:any)=>String(r?.id??"")===id);if(live)return live;
  // Imported and historical results live in qualification_results (uuid keys).
  if(!this.source.getStoredQualificationResult||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return null;return await this.value(this.source.getStoredQualificationResult(d,id));}
 listQualificationEvidence(d:string,id:string){this.check(d);return this.rows(this.source.listQualificationEvidence(d,id));}
 async drillTemplateExists(d:string,id:string){this.check(d);if(!/^[a-zA-Z0-9._:-]{1,255}$/.test(id))return false;const row=await this.value(this.source.getRangeWorkspace(d));return workspaceHasDrillTemplate(row?.workspace,id);}
 listDrillDocuments(d:string,id:string){this.check(d);return this.rows(this.source.listDrillDocuments(d,id));} getAttachment(d:string,id:string){this.check(d);return this.value(this.source.getAttachment(d,id));}
}
