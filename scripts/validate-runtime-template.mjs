import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {canonical} from './migration-manifest.mjs';
export function validateRuntimeTemplate(before,after,commit) {
 if(!/^[0-9a-f]{40}$/.test(commit))throw new Error('Full commit SHA required');
 for(const [id,resource] of Object.entries(before.Resources)) {
  const candidate=after.Resources[id];if(!candidate)throw new Error('Runtime resource removal refused');
  if(canonical(resource)===canonical(candidate)&&resource.Type!=='AWS::ECS::TaskDefinition')continue;
  if(resource.Type!=='AWS::ECS::TaskDefinition'||candidate.Type!==resource.Type)throw new Error('Unexpected runtime resource change');
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
  if(canonical(oldCopy)!==canonical(newCopy))throw new Error('Only the container image may change in a runtime release');
 }
 for(const [id,resource] of Object.entries(after.Resources))if(!before.Resources[id]&&resource.Type!=='AWS::CloudWatch::Alarm')throw new Error('Only additional alarms are permitted in a runtime release');
 for(const key of new Set([...Object.keys(before),...Object.keys(after)])) {
  if(['Resources','Metadata','Description'].includes(key))continue;
  if(canonical(before[key])!==canonical(after[key]))throw new Error('Unexpected template parameter, condition or output change');
 }
 return {safe:true,scope:'image replacement and additive alarms only'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [a,b,commit]=process.argv.slice(2);
 const parse=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
 console.log(JSON.stringify(validateRuntimeTemplate(await parse(a),await parse(b),commit)));
}
