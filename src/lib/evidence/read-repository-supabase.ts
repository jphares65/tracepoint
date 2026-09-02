import type { EvidenceReadDataSource, EvidenceResult } from "./read-repository-core.ts";
export type Query = PromiseLike<EvidenceResult> & { select(v:string):Query; eq(k:string,v:unknown):Query; is(k:string,v:null):Query; order(k:string,v:{ascending:boolean}):Query; maybeSingle():Query };
export type Client = { from(t:string):Query };
export class SupabaseEvidenceReadDataSource implements EvidenceReadDataSource {
  private client:Client; constructor(client:Client){this.client=client;}
  getFirearm(d:string,id:string){return this.client.from("firearms").select("id").eq("id",id).eq("department_id",d).maybeSingle();}
  listFirearmAttachments(d:string,id:string){return this.client.from("attachments").select("id,attachment_type,file_name,mime_type,file_size,description,uploaded_by_user_id,uploaded_at").eq("department_id",d).eq("entity_type","firearm").eq("entity_id",id).is("archived_at",null).order("uploaded_at",{ascending:false});}
  getRangeWorkspace(d:string){return this.client.from("pilot_range_workspaces").select("workspace").eq("department_id",d).maybeSingle();}
  listQualificationEvidence(d:string,id:string){return this.client.from("attachments").select("id,attachment_type,file_name,mime_type,file_size,description,uploaded_by_user_id,uploaded_at").eq("department_id",d).eq("entity_type","qualification").eq("entity_key",id).is("archived_at",null).order("uploaded_at",{ascending:false});}
  listDrillDocuments(d:string,id:string){return this.client.from("drill_documents").select("id,drill_template_id,original_filename,mime_type,file_size,uploaded_by_user_id,created_at").eq("department_id",d).eq("drill_template_id",id).order("created_at",{ascending:false});}
  getAttachment(d:string,id:string){return this.client.from("attachments").select("storage_path,file_name").eq("id",id).eq("department_id",d).is("archived_at",null).maybeSingle();}
}
