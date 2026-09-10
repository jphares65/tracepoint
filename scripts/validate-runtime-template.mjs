import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {canonical} from './migration-manifest.mjs';
export function validateRuntimeTemplate(before,after,commit,{allowReviewedControls=false,allowPrivateStorage=false,allowImporterSecretAlias=false,allowReviewedBridgeComposition=false}={}) {
 if(!/^[0-9a-f]{40}$/.test(commit))throw new Error('Full commit SHA required');
 for(const [id,resource] of Object.entries(before.Resources)) {
  const candidate=after.Resources[id];if(!candidate)throw new Error('Runtime resource removal refused');
  if(canonical(resource)===canonical(candidate)&&resource.Type!=='AWS::ECS::TaskDefinition')continue;
  // CDK telemetry includes the synthesizer's Node patch version. It has no runtime authority.
  if(resource.Type==='AWS::CDK::Metadata'&&candidate.Type===resource.Type) {
   const oldTelemetry=structuredClone(resource),newTelemetry=structuredClone(candidate);
   delete oldTelemetry.Properties.Analytics;delete newTelemetry.Properties.Analytics;
   if(canonical(oldTelemetry)===canonical(newTelemetry))continue;
  }
  if(resource.Type!=='AWS::ECS::TaskDefinition'||candidate.Type!==resource.Type)throw new Error('Unexpected runtime resource change: '+id+' ('+resource.Type+')');
  const oldCopy=structuredClone(resource);const newCopy=structuredClone(candidate);
  const oldContainers=oldCopy.Properties.ContainerDefinitions;const newContainers=newCopy.Properties.ContainerDefinitions;
  if(oldContainers.length!==1||newContainers.length!==1||newContainers[0].Name!=='tracepoint')throw new Error('Unexpected container layout');
  const image=newContainers[0].Image;
  // CDK joins an account-bound imported repository URI and the immutable commit tag.
  const expected=structuredClone(oldContainers[0].Image);
  const parts=expected?.['Fn::Join']?.[1];
  if(!Array.isArray(parts)||!/^:[0-9a-f]{40}$/.test(parts.at(-1)))throw new Error('Unsupported existing image reference');
  parts[parts.length-1]=':'+commit;
  if(canonical(image)!==canonical(expected))throw new Error('Image must retain the staging repository and select the exact commit');
  newContainers[0].Image=oldContainers[0].Image;
  if(allowPrivateStorage) {
   const oldEnv=oldContainers[0].Environment??[], newEnv=newContainers[0].Environment??[];
   const required={AWS_REGION:'us-east-1',TRACEPOINT_S3_BUCKET:'tracepoint-staging-private-559054714699',TRACEPOINT_S3_EXPECTED_OWNER:'559054714699'};
   if(oldEnv.find(e=>e.Name==='TRACEPOINT_STORAGE_PROVIDER')?.Value==='supabase' && newEnv.find(e=>e.Name==='TRACEPOINT_STORAGE_PROVIDER')?.Value==='s3') {
    for(const [name,value] of Object.entries(required))if((newEnv.filter(e=>e.Name===name).length!==1 || newEnv.find(e=>e.Name===name)?.Value!==value) || oldEnv.some(e=>e.Name===name))throw new Error('Unexpected private storage configuration');
    newContainers[0].Environment=newEnv.filter(e=>!(e.Name in required)).map(e=>e.Name==='TRACEPOINT_STORAGE_PROVIDER'?{...e,Value:'supabase'}:e);
   }
  }
  if(allowReviewedControls) {
   const oldEnv=oldContainers[0].Environment??[];
   const newEnv=newContainers[0].Environment??[];
   const oldSender=oldEnv.filter(e=>e.Name==='TRACEPOINT_FROM_EMAIL');
   const newSender=newEnv.filter(e=>e.Name==='TRACEPOINT_FROM_EMAIL');
   if(!oldSender.length&&newSender.length===1&&newSender[0].Value==='contact@tracepointhq.com') {
    const remaining=newEnv.filter(e=>e.Name!=='TRACEPOINT_FROM_EMAIL');
    if(oldContainers[0].Environment===undefined&&remaining.length===0) delete newContainers[0].Environment;
    else newContainers[0].Environment=remaining;
   }
   for(const key of ['DeletionPolicy','UpdateReplacePolicy']) if(newCopy[key]==='Retain') {
    if(oldCopy[key]===undefined) delete newCopy[key]; else newCopy[key]=oldCopy[key];
   }
  }
  if(allowImporterSecretAlias) {
   const oldSecrets=oldContainers[0].Secrets??[],newSecrets=newContainers[0].Secrets??[];
   const source=oldSecrets.filter(secret=>secret.Name==='SUPABASE_SECRET_KEY');
   const aliases=newSecrets.filter(secret=>secret.Name==='SUPABASE_SERVICE_ROLE_KEY');
   if(source.length!==1||aliases.length!==1||oldSecrets.some(secret=>secret.Name==='SUPABASE_SERVICE_ROLE_KEY')||canonical(aliases[0].ValueFrom)!==canonical(source[0].ValueFrom))throw new Error('Unexpected importer secret alias');
   newContainers[0].Secrets=newSecrets.filter(secret=>secret.Name!=='SUPABASE_SERVICE_ROLE_KEY');
  }
  if(allowReviewedBridgeComposition) {
   const oldEnv=oldContainers[0].Environment??[],newEnv=newContainers[0].Environment??[];
   const oldByName=new Map(oldEnv.map(entry=>[entry.Name,entry.Value]));
   const newByName=new Map(newEnv.map(entry=>[entry.Name,entry.Value]));
   const expectedExisting={TRACEPOINT_DATA_PROVIDER:'supabase',TRACEPOINT_EMAIL_PROVIDER:'brevo',TRACEPOINT_STORAGE_PROVIDER:'s3',TRACEPOINT_S3_BUCKET:'tracepoint-staging-private-559054714699',TRACEPOINT_S3_EXPECTED_OWNER:'559054714699',AWS_REGION:'us-east-1'};
   for(const [name,value] of Object.entries(expectedExisting))if(canonical(oldByName.get(name))!==canonical(value))throw new Error('Existing bridge storage configuration is not eligible for composition normalization');
   if(oldByName.has('TRACEPOINT_RUNTIME_PROVIDER_MODE')||oldByName.has('TRACEPOINT_AUTH_PROVIDER')||newByName.get('TRACEPOINT_RUNTIME_PROVIDER_MODE')!=='bridge'||newByName.get('TRACEPOINT_AUTH_PROVIDER')!=='supabase')throw new Error('Unexpected bridge provider composition');
   for(const [name,value] of Object.entries(expectedExisting))if(name!=='TRACEPOINT_S3_BUCKET'&&canonical(newByName.get(name))!==canonical(value))throw new Error('Unexpected bridge provider configuration');
   const expectedBucketImport={'Fn::ImportValue':'tracepoint-staging-storage:ExportsOutputRefObjectsA92BA4F157B12E12'};
   if(canonical(newByName.get('TRACEPOINT_S3_BUCKET'))!==canonical(expectedBucketImport))throw new Error('Unexpected bridge storage export');
   newContainers[0].Environment=newEnv.filter(entry=>!['TRACEPOINT_RUNTIME_PROVIDER_MODE','TRACEPOINT_AUTH_PROVIDER'].includes(entry.Name)).map(entry=>entry.Name==='TRACEPOINT_S3_BUCKET'?{...entry,Value:expectedExisting.TRACEPOINT_S3_BUCKET}:entry).sort((a,b)=>a.Name.localeCompare(b.Name));
   oldContainers[0].Environment=oldEnv.sort((a,b)=>a.Name.localeCompare(b.Name));
   if(oldContainers[0].Secrets)newContainers[0].Secrets=(newContainers[0].Secrets??[]).sort((a,b)=>a.Name.localeCompare(b.Name));
   if(oldContainers[0].Secrets)oldContainers[0].Secrets=oldContainers[0].Secrets.sort((a,b)=>a.Name.localeCompare(b.Name));
  }
  if(canonical(oldCopy)!==canonical(newCopy))throw new Error('Only the container image may change in a runtime release');
 }
 for(const [id,resource] of Object.entries(after.Resources))if(!before.Resources[id]&&resource.Type!=='AWS::CloudWatch::Alarm')throw new Error('Only additional alarms are permitted in a runtime release');
 for(const key of new Set([...Object.keys(before),...Object.keys(after)])) {
  if(['Resources','Metadata','Description'].includes(key))continue;
  if(canonical(before[key])!==canonical(after[key]))throw new Error('Unexpected template parameter, condition or output change');
 }
 return {safe:true,scope:allowPrivateStorage?'exact staging private storage activation and immutable image':allowReviewedControls?'image, verified sender addition, task retention and additive alarms':'image replacement and additive alarms only'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [a,b,commit]=process.argv.slice(2);
 const parse=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
 console.log(JSON.stringify(validateRuntimeTemplate(await parse(a),await parse(b),commit,{allowReviewedControls:process.argv.includes('--allow-reviewed-runtime-controls'),allowPrivateStorage:process.argv.includes('--allow-reviewed-private-storage'),allowImporterSecretAlias:process.argv.includes('--allow-reviewed-importer-secret-alias'),allowReviewedBridgeComposition:process.argv.includes('--allow-reviewed-bridge-composition')})));
}
