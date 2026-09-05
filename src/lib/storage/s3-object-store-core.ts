import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { attachmentPathFromMetadata, type ObjectStore, type AttachmentObjectPath, type DepartmentAssetObjectPath, type AttachmentUploadInput, type DepartmentPatchUploadInput } from "./object-store-core";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const failure = () => ({ message: "Object storage operation failed." });
export function departmentPatchPathFromMetadata(path: string, departmentId: string): DepartmentAssetObjectPath | null {
  return uuid.test(departmentId) && path.startsWith(departmentId + "/") && /^patch-[0-9]+\.(png|jpg|webp)$/.test(path.slice(departmentId.length + 1)) ? path as DepartmentAssetObjectPath : null;
}
export function requireS3Configuration(env: Record<string, string | undefined>) {
  const account=env.TRACEPOINT_S3_EXPECTED_OWNER, region=env.AWS_REGION, environment=env.CONFIGURATION_ENVIRONMENT;
  if(!account || !/^\d{12}$/.test(account) || account==='265544358665' || !region || !/^(us-east-1|us-gov-west-1|us-gov-east-1)$/.test(region)) throw new Error("Invalid private storage target");
  if(environment==='staging' ? account!=='559054714699'||region!=='us-east-1' : environment!=='production'||account==='559054714699') throw new Error("Storage environment mismatch");
  const bucket='tracepoint-'+environment+'-private-'+account;
  if(env.TRACEPOINT_S3_BUCKET!==bucket)throw new Error("Storage bucket mismatch");
  return {account,region,bucket};
}
type Signer = typeof getSignedUrl;
export class S3ObjectStore implements ObjectStore {
  constructor(private readonly client: S3Client, private readonly bucket: string, private readonly account: string, private readonly departmentId: string, private readonly sign: Signer = getSignedUrl) {
    if(!uuid.test(departmentId))throw new Error("Authorized department is required");
  }
  private attachment(path: string): AttachmentObjectPath {
    const safe=attachmentPathFromMetadata(path,this.departmentId);
    if(!safe || /[\x00-\x1f\x7f]/.test(path))throw new Error("Invalid authorized object path");
    // Reject nested encoding beyond the metadata decoder's supported depth.
    for(const segment of path.split('/')){let decoded=segment;for(let n=0;n<3;n++)decoded=decodeURIComponent(decoded);if(decoded.includes('%') || /[\x00-\x1f\x7f]/.test(decoded))throw new Error("Ambiguous object path");}
    return safe;
  }
  private patch(path: string) {const safe=departmentPatchPathFromMetadata(path,this.departmentId);if(!safe)throw new Error("Invalid authorized patch path");return safe;}
  private object(key: string) {return {Bucket:this.bucket,Key:key,ExpectedBucketOwner:this.account};}
  private async upload(domain: string, input: AttachmentUploadInput) {
    if(input.departmentId!==this.departmentId)throw new Error("Department mismatch");
    const name=input.fileName.replace(/[^a-zA-Z0-9._-]+/g,'-').slice(-120)||'file';
    const path=this.attachment(input.departmentId+'/'+domain+'/'+encodeURIComponent(input.recordId)+'/'+input.objectId+'-'+name);
    try {await this.client.send(new PutObjectCommand({...this.object('attachments/'+path),Body:input.bytes,ContentType:input.contentType,ServerSideEncryption:'AES256',IfNoneMatch:'*'}));return {path,error:null};}
    catch{return {path,error:failure()};}
  }
  uploadQualificationEvidence(input:AttachmentUploadInput){return this.upload('qualification',input);}
  uploadTrainingFile(input:AttachmentUploadInput){return this.upload('agency-training',input);}
  uploadFirearmAttachment(input:AttachmentUploadInput){return this.upload('firearm',input);}
  uploadDrillDocument(input:AttachmentUploadInput){return this.upload('drill-document',input);}
  async removeAttachment(path:AttachmentObjectPath){const key='attachments/'+this.attachment(path);try{await this.client.send(new DeleteObjectCommand(this.object(key)));return {error:null};}catch{return {error:failure()};}}
  private async signed(key:string,disposition?:string){try{return {signedUrl:await this.sign(this.client,new GetObjectCommand({...this.object(key),ResponseContentDisposition:disposition}),{expiresIn:60}),error:null};}catch{return {signedUrl:null,error:failure()};}}
  createAttachmentDownload(path:AttachmentObjectPath,fileName:string){const safeName=fileName.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120)||'download';return this.signed('attachments/'+this.attachment(path),'attachment; filename="'+safeName+'"');}
  createAttachmentView(path:AttachmentObjectPath){return this.signed('attachments/'+this.attachment(path),'inline');}
  async uploadDepartmentPatch(input:DepartmentPatchUploadInput){if(input.departmentId!==this.departmentId)throw new Error("Department mismatch");const path=this.patch(input.departmentId+'/patch-'+input.timestamp+'.'+input.extension);try{await this.client.send(new PutObjectCommand({...this.object('department-assets/'+path),Body:input.bytes,ContentType:input.contentType,ServerSideEncryption:'AES256',IfNoneMatch:'*'}));return {path,error:null};}catch{return {path,error:failure()};}}
  async createDepartmentPatchDelivery(path:DepartmentAssetObjectPath){return {signedUrl:'/api/settings/department-patch?path='+encodeURIComponent(this.patch(path)),error:null};}
  createDepartmentPatchView(path:DepartmentAssetObjectPath){return this.signed('department-assets/'+this.patch(path),'inline');}
  async removeDepartmentPatch(path:DepartmentAssetObjectPath){const key='department-assets/'+this.patch(path);try{await this.client.send(new DeleteObjectCommand(this.object(key)));return {error:null};}catch{return {error:failure()};}}
}
